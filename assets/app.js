/* --- RDZEŃ LOGICZNY APLIKACJI (JAVASCRIPT) --- */

// Zmienne globalne przechowujące sparsowane dane wejściowe
let rawData = [];            // Dwuwymiarowa tablica przechowująca wszystkie wiersze i kolumny liczbowe wyciągnięte z pliku CSV
let headers = [];            // Tablica jednowymiarowa zawierająca czyste nazwy kolumn pobrane z pierwszego wiersza pliku
let virtualColumns = [];      // Rejestr (tablica obiektów) przechowujący uchyby matematyczne wygenerowane przez użytkownika w kreatorze
let defaultErrorCounter = 1;    // Globalny licznik pomocniczy służący do automatycznego numerowania nazw kolejnych uchybów

// Referencje do instancji obiektów Chart.js. Kluczowe, by móc wyczyścić i usunąć wykres z pamięci RAM przed narysowaniem nowego
let fftChartInstance = null;  
let timeChartInstance = null; 
let jitterChartInstance = null; 

// Paleta wyrazistych, kontrastowych kolorów linii wykresów, zoptymalizowana i dobrana specjalnie pod ciemne tła (Neon Dark Mode)
const lineColors = [
	'#38bdf8', // Jasny, neonowy błękit (Sky Blue)
	'#f87171', // Pastelowa, czytelna czerwień (Coral Red)
	'#34d399', // Żywa, jasna zieleń (Emerald Green)
	'#fbbf24', // Ciepły, słoneczny żółty (Amber Gold)
	'#c084fc', // Jasny, wyrazisty fiolet (Lavender Purple)
	'#2dd4bf', // Świeży turkus (Teal)
	'#fb923c', // Pastelowy pomarańczowy (Orange)
	'#94a3b8', // Stalowy, neutralny szary
	'#a7f3d0', // Bardzo jasna, miętowa zieleń
	'#f472b6'  // Słodki, jaskrawy róż (Pink)
];

// --- GLOBALNE PARAMETRY GRAFICZNE DLA CHART.JS (DARK MODE) ---
// Konfigurujemy domyślne kolory opisów w bibliotece Chart.js, aby dopasować je do ciemnego szablonu strony
Chart.defaults.color = '#cbd5e1';                  // Kolor globalny tekstów osi i etykiet (Slate 300)
Chart.defaults.plugins.legend.labels.color = '#cbd5e1'; // Kolor czcionek legendy na górze wykresów

// Rejestracja detektorów zdarzeń (Event Listeners) przypisujących akcje do przycisków w interfejsie użytkownika
document.getElementById('excelFile').addEventListener('change', handleFile, false); // Wybór pliku inicjuje proces odczytu
document.getElementById('processBtn').addEventListener('click', processAll, false);  // Przycisk "Generuj Pełną Analizę" wyzwala obliczenia
document.getElementById('addErrorBtn').addEventListener('click', addNewVirtualError, false); // Przycisk dodawania uchybu w kreatorze

/**
 * Szybka Transformata Fouriera (FFT) zaimplementowana w klasycznym algorytmie dziesiątkowania w dziedzinie czasu (Cooley-Tukey Radix-2).
 * Wykonuje przekształcenie widmowe bezpośrednio w miejscu (in-place), modyfikując przekazane bufory pamięci, co daje ogromną szybkość.
 * @param {Float64Array} re - Część rzeczywista sygnału wejściowego (oraz wyjściowy bufor amplitudy rzeczywistej)
 * @param {Float64Array} im - Część urojona sygnału wejściowego (oraz wyjściowy bufor amplitudy urojonej)
 */
function fft(re, im) {
	const n = re.length; // Długość bufora (musi być potęgą liczby 2!)
	if (n <= 1) return;  // Warunek zakończenia rekurencji (baza podziału osiągnięta)
	
	// Tworzenie dynamicznych podtablic dla indeksów parzystych i nieparzystych próbki sygnału
	const reEven = new Float64Array(n / 2), imEven = new Float64Array(n / 2);
	const reOdd = new Float64Array(n / 2), imOdd = new Float64Array(n / 2);
	
	// Rozdzielanie danych wejściowych: parzyste lądują w Even, nieparzyste w Odd
	for (let i = 0; i < n / 2; i++) {
		reEven[i] = re[2 * i]; imEven[i] = im[2 * i];
		reOdd[i] = re[2 * i + 1]; imOdd[i] = im[2 * i + 1];
	}
	
	// Rekurencyjne wywołanie transformaty dla mniejszych podproblemów (dziel i zwyciężaj)
	fft(reEven, imEven);
	fft(reOdd, imOdd);
	
	// Rekonstrukcja widma (część matematyczna - tzw. "motylek FFT" z użyciem zespolonych współczynników obrotu)
	for (let k = 0; k < n / 2; k++) {
		const th = -2 * Math.PI * k / n; // Kąt fazowy dla danego prążka częstotliwości
		const wRe = Math.cos(th), wIm = Math.sin(th); // Liczba zespolona obrotu (Wzór Eulera)
		
		// Mnożenie zespolone: T = W * Odd[k]
		const tRe = wRe * reOdd[k] - wIm * imOdd[k];
		const tIm = wRe * imOdd[k] + wIm * reOdd[k];
		
		// Końcowe nadpisanie buforów: Łączenie wyników składowych parzystych i nieparzystych
		re[k] = reEven[k] + tRe; im[k] = imEven[k] + tIm;
		re[k + n / 2] = reEven[k] - tRe; im[k + n / 2] = imEven[k] - tIm;
	}
}

/**
 * Główny menedżer wczytywania plików: Obsługuje zdarzenie załadowania pliku logu z dysku,
 * analizuje strukturę tekstu CSV, eliminuje puste linie i oblicza częstotliwość próbkowania (Hz).
 */
function handleFile(e) {
	const file = e.target.files[0]; // Pobranie pliku wskazanego przez użytkownika
	if (!file) return;

	const reader = new FileReader(); // Utworzenie natywnego obiektu czytnika plików JavaScript
	reader.onload = function(e) {
		const text = e.target.result; // Surowa zawartość tekstowa pliku logu
		const lines = text.split(/\r?\n/); // Rozbicie tekstu na tablicę wierszy przy użyciu wyrażenia regularnego (obsługa Windows/Linux)
		
		// Minimalna walidacja poprawności logu strukturalnego
		if (lines.length < 3) {
			showError("Plik zawiera zbyt mało danych do analizy.");
			return;
		}

		// Rozbicie pierwszego wiersza pliku na pojedyncze nazwy kolumn (zakładamy separator średnik ';')
		headers = lines[0].split(';').map(h => h.trim());

		// Czyszczenie globalnej tablicy i parowanie danych wiersz po wierszu
		rawData = [];
		for (let i = 1; i < lines.length; i++) {
			if (lines[i].trim() === '') continue; // Ignorowanie pustych linii, np. na samym końcu pliku
			const columns = lines[i].split(';');  // Podział linii na pojedyncze komórki liczbowe
			rawData.push(columns);                // Wrzucenie wiersza danych do bazy
		}

		// --- AUTOMATYCZNE OBLICZANIE CZĘSTOTLIWOŚCI PRÓBKOWANIA (Hz) ---
		// Pobieramy kolumnę o indeksie 0 (zawsze Timestamp) i parsujemy ją na liczby, odrzucając błędy NaN
		let timestamps = rawData.map(row => parseFloat(row[0])).filter(val => !isNaN(val));
		if (timestamps.length >= 2) {
			let diffSum = 0;  // Suma różnic czasowych pomiędzy próbkami
			let count = 0;    // Licznik poprawnych przejść pętli
			
			// Pętla obliczająca różnice czasu krok po kroku (Różniczkowanie dyskretne czasu)
			for(let i = 1; i < timestamps.length; i++) {
				let diff = timestamps[i] - timestamps[i-1]; // dt = t[n] - t[n-1]
				if(diff > 0) { // Zabezpieczenie przed cofnięciem czasu lub błędami powtórzonej próbki
					diffSum += diff;
					count++;
				}
			}
			
			// Jeżeli zebraliśmy poprawne próbki, wyliczamy średnią i przekształcamy na Herc (Hz)
			if (count > 0) {
				let avgDiffMs = diffSum / count;   // Średni interwał pętli sterowania wyrażony w milisekundach
				let avgDiffSec = avgDiffMs / 1000; // Konwersja milisekund na sekundy
				let calculatedFs = 1 / avgDiffSec; // Częstotliwość Hz = 1 / sekundy
				
				// Wstrzyknięcie obliczonej wartości do pola formularza oraz panelu informacyjnego HTML
				document.getElementById('sampleRate').value = calculatedFs.toFixed(2);
				document.getElementById('fsInfo').innerText = `Wykryto krok: ${avgDiffMs.toFixed(1)} ms (~${calculatedFs.toFixed(1)} Hz)`;
			}
		}

		// Resetowanie pamięci podręcznej wirtualnych uchybów przy ładowaniu zupełnie nowego logu maszynowego
		virtualColumns = []; 
		defaultErrorCounter = 1;
		document.getElementById('errorName').value = `Uchyb Osi ${defaultErrorCounter}`;

		// Wywołanie procedury generowania dynamicznych kontrolek UI (list i checkboxów)
		rebuildUIOptions();

		// Uwidocznienie schowanych do tej pory sekcji interfejsu (CSS display: none -> block)
		document.getElementById('checkboxSection').style.display = 'block';
		document.getElementById('creatorSection').style.display = 'block';

		// --- PARSOWANIE PARAMETRÓW URZĄDZENIA Z NAGŁÓWKA PLIKU CSV ---
		const paramsGrid = document.getElementById('paramsGrid');
		paramsGrid.innerHTML = ''; // Wyczyszczenie starych plakietek konfiguracji
		let hasParams = false;
		
		// Przeszukujemy nagłówki: jeśli nazwa zawiera znak "=", oznacza to parametr konfiguracyjny (np. TS.Igain=100)
		headers.forEach(h => {
			if(h && h.includes('=')) {
				hasParams = true;
				const badge = document.createElement('div'); // Stworzenie elementu HTML
				badge.className = 'param-badge';             // Przypisanie klasy CSS stylizującej pigułkę
				badge.innerText = h;                         // Wpisanie tekstu parametru
				paramsGrid.appendChild(badge);               // Dodanie pigułki na ekran
			}
		});
		// Pokazujemy cały panel parametrów tylko wtedy, gdy w pliku znaleziono choć jeden zapis konfiguracji
		document.getElementById('paramsSection').style.display = hasParams ? 'block' : 'none';

		// Odblokowanie przycisków sterujących, które były zamrożone do czasu wgrania logu
		document.getElementById('columnSelect').disabled = false;
		document.getElementById('processBtn').disabled = false;
		showError(""); // Czyszczenie starych logów awarii
		document.getElementById('creatorFeedback').innerText = ""; // Czyszczenie komunikatów kreatora
	};
	
	reader.readAsText(file); // Uruchomienie asynchronicznego czytnika w formacie tekstowym UTF-8
}

/**
 * Budowniczy Interfejsu: Czyści i od nowa generuje pozycje w listach rozwijanych oraz tworzy siatkę checkboxów.
 * UWAGA: Zgodnie z wytycznymi, fizyczne kolumny posiadają teraz w nazwie jawny indeks tekstowy typu "(Kolumna X)".
 */
function rebuildUIOptions() {
	const selectFFT = document.getElementById('columnSelect');
	const selectSP = document.getElementById('spSelect');
	const selectR = document.getElementById('rSelect');
	const checkboxGrid = document.getElementById('checkboxGrid');

	// Sprytne zapamiętanie aktualnego stanu zaznaczenia checkboxów na dole. 
	// Dzięki temu, gdy użytkownik doda nowy uchyb z kreatora, dotychczas zaznaczone ptaszki nie zostaną zresetowane!
	const checkedValues = Array.from(document.querySelectorAll('input[name="timeSignals"]:checked')).map(cb => cb.value);

	// Wyczyszczenie starych węzłów w strukturze DOM HTML przed odbudową
	selectFFT.innerHTML = '';
	selectSP.innerHTML = '';
	selectR.innerHTML = '';
	checkboxGrid.innerHTML = '';

	let totalAvailable = 0; // Pomocniczy licznik kolumn sygnałowych

	// 1. ITERACJA PO FIZYCZNYCH KOLUMNACH PLIKU LOGU CSV
	headers.forEach((header, index) => {
		// Pomijamy kolumnę 0 (Czas) oraz wszystkie parametry konfiguracyjne zawierające znak '='
		if (index === 0 || !header || header.includes('=')) return; 

		let valId = `f_${index}`; // Unikalny identyfikator wewnętrzny systemu: f_ oznacza kolumnę fizyczną z pliku
		let userFriendlyName = `${header} (Kolumna ${index + 1})`; // Sformatowany podpis wymagany przez użytkownika

		// Wstrzykiwanie opcji do list rozwijanych (Select) w interfejsie
		appendOption(selectFFT, valId, userFriendlyName); // Lista główna wyboru sygnału do widma FFT
		appendOption(selectSP, index, userFriendlyName);   // Wybór wartości zadanej dla kreatora uchybów
		appendOption(selectR, index, userFriendlyName);    // Wybór wartości rzeczywistej dla kreatora uchybów

		// Automatyczne budowanie pola typu checkbox dla wykresu czasowego
		// Przy pierwszym załadowaniu pliku (gdy checkedValues jest puste) zaznaczamy domyślnie 2 pierwsze serie danych
		let shouldCheck = checkedValues.length === 0 ? (totalAvailable < 2) : checkedValues.includes(valId);
		createCheckbox(userFriendlyName, valId, checkboxGrid, shouldCheck);
		totalAvailable++;
	});

	// 2. ITERACJA PO DYNAMICZNYCH UCHYBACH WIRTUALNYCH STWORZONYCH PRZEZ UŻYTKOWNIKA
	virtualColumns.forEach((vCol, vIdx) => {
		let valId = `v_${vIdx}`; // Identyfikator wewnętrzny systemu: v_ oznacza uchyb wirtualny wyliczony w RAM
		let labelText = `[Wirtualny] ${vCol.name}`; // Czytelne wyróżnienie serii na liście
		
		appendOption(selectFFT, valId, labelText); // Dodanie uchybu do listy analizy widmowej FFT
		
		let shouldCheck = checkedValues.includes(valId); // Przywrócenie zaznaczenia checkboxa jeśli istniało wcześniej
		createCheckbox(labelText, valId, checkboxGrid, shouldCheck);
	});
}

// Funkcja pomocnicza: wstrzykuje pojedynczy element <option> do wskazanego znaczka <select>
function appendOption(selectElement, value, text) {
	const opt = document.createElement('option');
	opt.value = value;
	opt.text = text;
	selectElement.appendChild(opt);
}

// Funkcja pomocnicza: buduje kompletny element drzewa DOM reprezentujący etykietę i pole typu checkbox
function createCheckbox(text, value, container, isChecked) {
	const labelNode = document.createElement('label');
	labelNode.className = 'checkbox-item';
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.value = value;
	checkbox.name = 'timeSignals'; // Nazwa grupująca pola wyboru linii
	checkbox.checked = isChecked;  // Nadanie flagi zaznaczenia
	labelNode.appendChild(checkbox);
	labelNode.appendChild(document.createTextNode(text)); // Doklejenie tekstu podpisu obok ptaszka
	container.appendChild(labelNode); // Wstrzyknięcie gotowego elementu na stronę www
}

/**
 * SILNIK KREATORA WIRTUALNYCH UCHYBÓW REGULACJI AUTOMATYKI
 * Pobiera wskazane przez użytkownika indeksy kolumn SP oraz Real, dokonuje punktowego odejmowania
 * matematycznego wartości w pętli dla każdego wiersza, a wynik zapisuje w globalnym rejestrze.
 */
function addNewVirtualError() {
	// Pobranie aktualnie wybranych indeksów kolumn z list rozwijanych kreatora
	const spIdx = parseInt(document.getElementById('spSelect').value);
	const rIdx = parseInt(document.getElementById('rSelect').value);
	let customName = document.getElementById('errorName').value.trim(); // Pobranie nazwy własnej wpisanej w polu tekstowym

	// Jeśli użytkownik zostawił puste pole tekstowe, przypisujemy nazwę automatyczną z licznika
	if(!customName) {
		customName = `Uchyb Osi ${defaultErrorCounter}`;
	}

	// --- RDZEŃ MATEMATYCZNY KREATORA: Uchyb (Error) = Wartość Zadana (SP) - Wartość Rzeczywista (Real) ---
	// Mapujemy całą tablicę rawData wiersz po wierszu realizując dyskretne odejmowanie sygnałów
	let errorData = rawData.map(row => {
		// Zabezpieczenie na wypadek uszkodzonego wiersza danych lub braku żądanej komórki
		if (!row || row[spIdx] === undefined || row[rIdx] === undefined) return NaN;
		
		// Konwersja tekstu z pliku CSV na liczby zmiennoprzecinkowe JS. 
		// .replace(',', '.') daje pewność, że jeśli w pliku użyto europejskiego przecinka dziesiętnego, program się nie wykrzywi.
		let spVal = parseFloat(row[spIdx].toString().replace(',', '.'));
		let rVal = parseFloat(row[rIdx].toString().replace(',', '.'));
		return spVal - rVal; // Wynik różnicy uchybu regulacji dla danej próbki czasu
	});

	// Zapisanie wyliczonego profilu uchybu jako nowego, niezależnego sygnału w rejestrze aplikacji
	virtualColumns.push({
		name: customName,
		spIndex: spIdx,
		rIndex: rIdx,
		data: errorData
	});

	// Wyświetlenie zielonego komunikatu potwierdzającego sukces operacji pod panelem
	document.getElementById('creatorFeedback').innerText = `Pomyślnie utworzono sygnał wirtualny: "${customName}"!`;
	
	// Zwiększenie licznika globalnego i przygotowanie nazwy pod kolejny uchyb (np. Uchyb Osi 2)
	defaultErrorCounter++;
	document.getElementById('errorName').value = `Uchyb Osi ${defaultErrorCounter}`;
	
	// Przebudowanie list i checkboxów, aby nowo stworzony uchyb natychmiast pojawił się w opcjach wyboru aplikacji!
	rebuildUIOptions();
}

/**
 * Uniwersalny ekstraktor danych: Rozpoznaje po prefiksie identyfikatora (`f_` lub `v_`), czy użytkownik zażądał
 * kolumny fizycznej z pliku logu, czy uchybu wirtualnego z pamięci RAM i zwraca jednolitą strukturę danych.
 * @param {string} id - Identyfikator wewnętrzny elementu (np. "f_3" lub "v_0")
 */
function getSignalData(id) {
	if (id.startsWith('f_')) { // Przypadek wyciągania kolumny fizycznej bezpośrednio ze sparsowanego pliku CSV
		let colIndex = parseInt(id.replace('f_', '')); // Wyciągnięcie czystego indeksu kolumny
		let name = headers[colIndex];                  // Pobranie nazwy z nagłówka pliku
		let data = rawData.map(row => {
			if (!row || row[colIndex] === undefined || row[colIndex] === null) return NaN;
			return parseFloat(row[colIndex].toString().replace(',', '.')); // Konwersja tekstu na liczbę zmiennoprzecinkową
		});
		return { name: `${name} (Kolumna ${colIndex + 1})`, data: data, isVirtual: false };
	} else { // Przypadek wyciągania wirtualnego uchybu wyliczonego wcześniej w pamięci RAM aplikacji
		let vIdx = parseInt(id.replace('v_', '')); // Wyciągnięcie indeksu uchybu z rejestru
		let vCol = virtualColumns[vIdx];           // Pobranie obiektu uchybu
		return { name: vCol.name, data: vCol.data, isVirtual: true };
	}
}

/**
 * Główny koordynator procesu obliczeniowego aplikacji: Aktywuje kontenery wykresów na stronie,
 * po czym sekwencyjnie uruchamia dedykowane silniki obliczeniowo-renderujące dla każdego modułu.
 */
function processAll() {
	// Odkrycie wszystkich ukrytych sekcji wykresów, paneli sterowania oraz statystyk w strukturze HTML
	document.getElementById('titleFFT').style.display = 'flex';
	document.getElementById('containerFFT').style.display = 'block';
	document.getElementById('panelFFT').style.display = 'flex';

	document.getElementById('titleTime').style.display = 'flex';
	document.getElementById('containerTime').style.display = 'block';
	document.getElementById('panelTime').style.display = 'flex';

	document.getElementById('statsSection').style.display = 'block'; 

	document.getElementById('titleJitter').style.display = 'flex'; 
	document.getElementById('containerJitter').style.display = 'block';
	document.getElementById('panelJitter').style.display = 'flex';

	// Wywołanie niezależnych modułów diagnostycznych
	processFFT();              // Moduł 1: Transformacja Fouriera i analiza częstotliwościowa
	processTimeDomainAndStats(); // Moduł 2: Rysowanie przebiegów czasowych + kalkulator wskaźników MSE i Peak-to-Peak
	processJitterAnalysis();     // Moduł 3: Analiza różnicowa osi czasu i badanie stabilności pętli zegara czasu rzeczywistego
}

/**
 * MODUŁ 1: SILNIK ANALIZY CZĘSTOTLIWOŚCIOWEJ (TRANSFORMATA FFT)
 * Pobiera wskazany sygnał, odcina uszkodzone rekordy, eliminuje składową stałą sygnału (DC Bias),
 * realizuje uzupełnianie zerami (Zero-Padding) do potęgi dwójki i wyznacza jednostronne widmo gęstości energii.
 */
function processFFT() {
	const sampleRate = parseFloat(document.getElementById('sampleRate').value); // Częstotliwość próbkowania w Hz
	const columnId = document.getElementById('columnSelect').value;             // Pobranie ID wybranego sygnału do FFT
	
	// Walidacja poprawności wpisanej lub wykrytej częstotliwości próbkowania
	if (isNaN(sampleRate) || sampleRate <= 0) return;

	let sigInfo = getSignalData(columnId); // Pobranie ujednoliconego obiektu sygnału
	let signal = sigInfo.data.filter(val => !isNaN(val)); // Odcięcie pustych rekordów lub uszkodzonych próbek (NaN)

	if (signal.length < 8) return; // Zabezpieczenie przed zbyt krótką serią danych do analizy częstotliwościowej

	// --- ZERO-PADDING (UZUPEŁNIANIE ZERAMI DO POTĘGI LICZBY 2) ---
	// Algorytm FFT Radix-2 wymaga, by długość wektora wejściowego była idealną potęgą dwójki (np. 1024, 2048, 4096...).
	// Wyznaczamy najbliższą, większą lub równą potęgę dwójki przy użyciu algorytmu logarytmicznego.
	const originalLength = signal.length;
	const n = Math.pow(2, Math.ceil(Math.log2(originalLength)));
	
	let re = new Float64Array(n); // Alokacja szybkiego bufora części rzeczywistej
	let im = new Float64Array(n); // Alokacja szybkiego bufora części urojonej (wypełniana zerami)
	
	// --- USUNIĘCIE SKŁADOWEJ STAŁEJ (DC BIAS REMOVAL) ---
	// Obliczamy wartość średnią (średnią arytmetyczną) całego sygnału. Usunięcie składowej stałej zapobiega
	// powstawaniu gigantycznego piku amplitudy dla częstotliwości 0 Hz, który zniekształciłby skalowanie pionowe widma.
	let sum = 0;
	for(let i=0; i<originalLength; i++) sum += signal[i];
	let mean = sum / originalLength;

	// Przepisanie danych do bufora roboczego FFT z jednoczesnym odjęciem wyliczonej wartości średniej sygnału
	for (let i = 0; i < n; i++) {
		re[i] = i < originalLength ? (signal[i] - mean) : 0; // Wstrzykiwanie zer (Padding) powyżej oryginalnego rozmiaru logu
		im[i] = 0; // Sygnał wejściowy w dziedzinie czasu nie posiada składowej urojonej
	}

	// URUCHOMIENIE TRANSFORMATY: Wywołanie rdzenia algorytmu matematycznego FFT
	fft(re, im);

	const halfN = n / 2; // Widmo sygnału rzeczywistego jest symetryczne, analizujemy tylko pierwszą połowę (od 0 do Fs/2)
	const frequencies = []; // Tablica opisów osi poziomej X (Częstotliwości w Hz)
	const magnitudes = [];  // Tablica wartości osi pionowej Y (Amplitudy poszczególnych harmonicznych)

	// Skalowanie amplitudy i mapowanie częstotliwości
	for (let i = 0; i < halfN; i++) {
		let freq = (i * sampleRate) / n; // Wyznaczenie fizycznej częstotliwości w Hz dla i-tego prążka widma
		frequencies.push(freq);
		
		// Obliczenie modułu liczby zespolonej (amplitudy widma): |X| = sqrt(Re^2 + Im^2)
		let mag = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / originalLength;
		
		// Korekta energii dla widma jednostronnego: Składowe (oprócz DC dla i=0) mnożymy razy 2, 
		// ponieważ skompresowaliśmy energię z odrzuconej, symetrycznej połowy widma.
		magnitudes.push(i === 0 ? mag : mag * 2); 
	}

	// Przekazanie przetworzonych wektorów do funkcji renderującej wykres Chart.js
	drawFFTChart(frequencies, magnitudes, sigInfo.name);
}

/**
 * MODUŁ 2: PRZEBIEG CZASOWY SYGNAŁÓW + KALKULATOR STATYSTYK JAKOŚCI REGULACJI
 * Pobiera serie zaznaczone ptaszkami przez użytkownika, przygotowuje obiekty serii danych dla Chart.js
 * oraz wylicza zaawansowane wskaźniki jakości: Błąd Średniokwadratowy (MSE) oraz rozstęp Peak-to-Peak.
 */
function processTimeDomainAndStats() {
	// Generowanie osi X czasu: wyciągamy kolumnę 0 i filtrujemy ewentualne uszkodzone rekordy
	let timeLabels = rawData.map(row => parseFloat(row[0])).filter(val => !isNaN(val));
	const checkboxes = document.querySelectorAll('input[name="timeSignals"]:checked'); // Pobranie zaznaczonych checkboxów
	const datasets = []; // Zbiorcza tablica serii wykresu czasowego Chart.js
	let statsHTML = "";  // Łańcuch tekstowy HTML, do którego dokleimy wygenerowane raporty kafelkowe

	// Przetwarzanie każdej zaznaczonej serii danych
	checkboxes.forEach((cb, index) => {
		let sigInfo = getSignalData(cb.value); // Wyciągnięcie danych liczbowych sygnału

		// Budowanie struktury konfiguracyjnej serii dla Chart.js
		datasets.push({
			label: sigInfo.name, // Nazwa wyświetlana w legendzie wykresu
			data: sigInfo.data,  // Tablica punktów czasowych Y
			borderColor: lineColors[index % lineColors.length], // Przypisanie kolejnego koloru z unikalnej palety neonowej
			backgroundColor: 'transparent', // Brak wypełnienia obszaru pod linią (zapewnia przejrzystość)
			borderWidth: 1.5,               // Grubość rysowanej linii przebiegu
			pointRadius: 0,                 // WYDAJNOŚĆ: Wyłączenie rysowania kropek dla każdego z tysięcy punktów (drastically przyspiesza renderowanie!)
			pointHoverRadius: 4,            // Kropka pomiarowa ujawnia się dopiero wtedy, gdy użytkownik najedzie myszą bezpośrednio na linię sygnału
			tension: 0.05                   // Delikatne wygładzenie załamań linii wykresu
		});

		// --- PRZETWARZANIE AGREGATÓW STATYSTYCZNYCH SERII ---
		let cleanData = sigInfo.data.filter(v => !isNaN(v)); // Odrzucenie rekordów uszkodzonych
		if(cleanData.length > 0) {
			let min = Math.min(...cleanData); // Wyznaczenie najmniejszej zarejestrowanej wartości w logu
			let max = Math.max(...cleanData); // Wyznaczenie największej zarejestrowanej wartości w logu
			let p2p = max - min;              // Obliczenie rozstępu Peak-to-Peak (amplituda maksymalna zmian sygnału)
			
			let mseText = "N/A (Wybierz Uchyb)"; // Domyślny tekst dla surowych danych (niebędących uchybem)
			let maxDevText = "N/A";

			// KLUCZOWA FUNKCJONALNOŚĆ: Jeśli seria jest wirtualnym uchybem, liczymy wskaźniki dokładności automatyki regulacji!
			if (sigInfo.isVirtual) {
				let squareSum = 0; // Suma kwadratów błędów regulacji
				let maxDev = 0;    // Zmienna przechowująca maksymalne chwilowe odchylenie od zera
				
				cleanData.forEach(err => {
					squareSum += err * err; // Sumowanie kwadratów wartości błędu: e^2
					if(Math.abs(err) > maxDev) maxDev = Math.abs(err); // Detekcja najgorszego, maksymalnego błędu chwilowego
				});
				
				// MSE (Mean Squared Error) = (1/N) * Suma(e^2)
				mseText = (squareSum / cleanData.length).toFixed(4); // Obliczenie błędu średniokwadratowego z zaokrągleniem do 4 miejsc
				maxDevText = maxDev.toFixed(2);                      // Maksymalny zanotowany uchyb regulacji
			}

			// Generowanie struktury kafelków informacyjnych w HTML z podstawieniem wyliczonych zmiennych statystycznych
			statsHTML += `
				<div style="margin-bottom: 20px;">
					<strong style="color:${lineColors[index % lineColors.length]}; font-size:14px;">📊 Seria: ${sigInfo.name}</strong>
					<div class="stats-grid">
						<div class="stat-card"><div class="stat-title">Błąd Średniokwadratowy (MSE)</div><div class="stat-value">${mseText}</div></div>
						<div class="stat-card"><div class="stat-title">Maks. Odchyłka (Max Error)</div><div class="stat-value">${maxDevText}</div></div>
						<div class="stat-card"><div class="stat-title">Rozstęp Peak-to-Peak</div><div class="stat-value">${p2p.toFixed(2)}</div></div>
						<div class="stat-card"><div class="stat-title">Min / Max rejestracji</div><div class="stat-value" style="font-size:13px; color:#94a3b8;">Min: ${min.toFixed(1)}<br>Max: ${max.toFixed(1)}</div></div>
					</div>
				</div>
			`;
		}
	});

	// Wstrzyknięcie gotowego bloku HTML z statystykami na stronę www
	document.getElementById('statsGrid').innerHTML = statsHTML || "Nie zaznaczono żadnych linii sygnałowych.";
	
	// Wywołanie procedury rysującej wykres osi czasu Chart.js
	drawTimeChart(timeLabels, datasets);
}

/**
 * MODUŁ 3: SILNIK DIAGNOSTKI JITTERU I ANALIZY CZASU RZECZYWISTEGO STEROWNIKA
 * Bada stabilność zegara systemowego procesora maszynowego. Różniczkuje czas rejestracji,
 * wyłapuje zacięcia wątku wykonawczego regulatora i zlicza anomalie czasowe.
 */
function processJitterAnalysis() {
	let timestamps = rawData.map(row => parseFloat(row[0])).filter(val => !isNaN(val)); // Pobranie osi czasu
	if (timestamps.length < 2) return;

	let jitterData = [];     // Tablica wartości osi pionowej Y (wyliczone odstępy czasowe dt)
	let jitterLabels = [];   // Tablica punktów osi poziomej X (moment wystąpienia próbki)
	let diffSum = 0;         // Sumator interwałów czasowych
	let packetLossCount = 0; // Licznik krytycznych zacięć pętli/mikrosekundowych zawieszeń sterownika

	// Dyskretne różniczkowanie: Interwał dt = t[i] - t[i-1] dla każdego sąsiedniego punktu w czasie
	for (let i = 1; i < timestamps.length; i++) {
		let dt = timestamps[i] - timestamps[i-1];
		if (dt <= 0) dt = NaN; // Eliminacja błędów sprzętowych (gdy czas stoi w miejscu lub się cofa)
		jitterData.push(dt);
		jitterLabels.push(timestamps[i]);
		if(!isNaN(dt)) diffSum += dt; // Sumowanie interwałów do obliczenia średniej globalnej
	}

	let cleanJitter = jitterData.filter(v => !isNaN(v)); // Odrzucenie rekordów uszkodzonych
	let avgDt = diffSum / cleanJitter.length;             // Średni fizyczny interwał pętli wykonawczej procesora (ms)
	let maxDt = Math.max(...cleanJitter);                 // Wykrycie skrajnego, najgorszego zacięcia wątku maszyny (Worst-case latency)
	
	// Algorytm detekcji anomalii Jitteru: Jeśli czas wykonania pętli przekroczył średnią wartość o ponad 50% (avgDt * 1.5),
	// kwalifikujemy to zdarzenie jako niebezpieczne zacięcie mikroprocesora (Jitter/Real-time breach).
	let lossThreshold = avgDt * 1.5;
	cleanJitter.forEach(dt => {
		if (dt > lossThreshold) packetLossCount++; // Zwiększenie licznika incydentów niestabilności zegara
	});

	// Dynamiczne wygenerowanie tekstu podsumowania diagnostycznego Jitteru i wstrzyknięcie go bezpośrednio do nagłówka wykresu nr 3
	let jitterTitleNode = document.getElementById('titleJitter').firstElementChild;
	jitterTitleNode.innerHTML = `Analiza stabilności czasu rzeczywistego | <span style="color:#fb923c;">Średni krok: ${avgDt.toFixed(2)} ms</span> | <span style="color:#f87171;">Najgorsze zacięcie (Max): ${maxDt.toFixed(1)} ms</span> | <span style="color:#c084fc;">Zacięcia pętli (>50% opóźnienia): ${packetLossCount} razy</span>`;

	// Wywołanie procedury rysującej wykres Jitteru Chart.js
	drawJitterChart(jitterLabels, jitterData);
}


/* --- SEKTY DEFINIOWANIA, INTEGRACJI I DOSTOSOWANIA SIATEK WYKRESÓW CHART.JS DO DARK MODE --- */

/**
 * Wspólna struktura konfiguracyjna stylizująca osie wykresów pod kątem wysokiego kontrastu w Dark Mode.
 * Zmienia kolory linii pomocniczych (siatki wewnętrznej) oraz kolory opisów wartości liczbowych na osiach.
 */
const darkScaleConfig = {
	grid: {
		color: '#334155',       // Kolor siatki pomocniczej wewnątrz wykresu: matowy ciemnoszary (Slate 700)
		borderColor: '#475569'  // Kolor osi bazowej zamykającej wykres (Slate 600)
	},
	ticks: {
		color: '#94a3b8'        // Kolor czcionek wartości numerycznych podziałki osi X oraz Y (Slate 400)
	}
};

/**
 * Rysuje Wykres 1 (Widmo Energii FFT).
 */
function drawFFTChart(labels, data, columnName) {
	const ctx = document.getElementById('fftChart').getContext('2d');
	if (fftChartInstance) fftChartInstance.destroy(); // Bezpieczne czyszczenie RAM - niszczenie starej instancji przed nadpisaniem
	
	// Odczytanie ewentualnych ręcznych wartości granicznych osi wyznaczonych przez użytkownika
	const xMinVal = parseFloat(document.getElementById('fftXMin').value);
	const xMaxVal = parseFloat(document.getElementById('fftXMax').value);
	const yMinVal = parseFloat(document.getElementById('fftYMin').value);
	const yMaxVal = parseFloat(document.getElementById('fftYMax').value);

	const xScaleObj = Object.assign({ 
		type: 'linear', 
		title: { display: true, text: 'Częstotliwość (Hz)', color: '#cbd5e1' }, 
		ticks: { callback: function(v) { return Math.round(v); }, color: '#94a3b8' } 
	}, darkScaleConfig);

	const yScaleObj = Object.assign({ 
		title: { display: true, text: 'Amplituda', color: '#cbd5e1' }, 
		beginAtZero: isNaN(yMinVal) 
	}, darkScaleConfig);

	if (!isNaN(xMinVal)) xScaleObj.min = xMinVal;
	if (!isNaN(xMaxVal)) xScaleObj.max = xMaxVal;
	if (!isNaN(yMinVal)) yScaleObj.min = yMinVal;
	if (!isNaN(yMaxVal)) yScaleObj.max = yMaxVal;

	fftChartInstance = new Chart(ctx, {
		type: 'line', // Wykres liniowy
		data: {
			labels: labels, // Częstotliwości w Hz na osi X
			datasets: [{
				label: `Widmo energii dla: ${columnName}`,
				data: data, // Amplitudy na osi Y
				borderColor: '#38bdf8', // Fluorescencyjny, jasnoniebieski kolor linii sygnału (Sky Blue)
				backgroundColor: 'rgba(56, 189, 248, 0.08)', // Półprzeźroczyste, delikatne wypełnienie obszaru pod widmem
				borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0.1
			}]
		},
		options: {
			responsive: true, maintainAspectRatio: false, // Elastyczne rozciąganie wykresu do pełnych rozmiarów kontenera div
			interaction: { mode: 'index', intersect: false }, // Wyświetlanie etykiety pomocniczej po najechaniu w pionie
			scales: {
				x: xScaleObj,
				y: yScaleObj
			},
			plugins: {
				// Aktywacja silnika powiększeń i przesuwania wykresu kółkiem myszy
				zoom: { 
					zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, // Powiększanie aktywne tylko dla osi poziomej X
					pan: { enabled: true, mode: 'x' } // Przesuwanie wykresu przeciąganiem myszy w osi X
				},
				// Stylizacja dymków podpowiedzi (Tooltips) po najechaniu myszką (Dostosowanie kolorów do Dark Mode)
				tooltip: { 
					backgroundColor: '#1e293b', // Ciemne tło dymku podpowiedzi
					titleColor: '#f8fafc',      // Biały tytuł dymku
					bodyColor: '#cbd5e1',       // Jasny popiel tekstu parametrów w dymku
					borderColor: '#475569',     // Ramka okienka dymku
					borderWidth: 1, 
					callbacks: { 
						label: function(c) { return `Amplituda: ${c.raw.toFixed(4)}`; }, 
						title: function(c) { return `Częstotliwość: ${parseFloat(c[0].label).toFixed(2)} Hz`; } 
					} 
				}
			}
		}
	});
}

/**
 * Rysuje Wykres 2 (Przebieg czasowy wielu sygnałów jednocześnie).
 */
function drawTimeChart(labels, datasets) {
	const ctx = document.getElementById('timeChart').getContext('2d');
	if (timeChartInstance) timeChartInstance.destroy(); // Zwolnienie zasobów pamięci operacyjnej przed nowym rysowaniem
	
	// Odczytanie ewentualnych ręcznych wartości granicznych osi wyznaczonych przez użytkownika
	const xMinVal = parseFloat(document.getElementById('timeXMin').value);
	const xMaxVal = parseFloat(document.getElementById('timeXMax').value);
	const yMinVal = parseFloat(document.getElementById('timeYMin').value);
	const yMaxVal = parseFloat(document.getElementById('timeYMax').value);

	const xScaleObj = Object.assign({ type: 'linear', title: { display: true, text: 'Czas (Timestamp / ms)', color: '#cbd5e1' } }, darkScaleConfig);
	const yScaleObj = Object.assign({ title: { display: true, text: 'Wartość', color: '#cbd5e1' } }, darkScaleConfig);

	if (!isNaN(xMinVal)) xScaleObj.min = xMinVal;
	if (!isNaN(xMaxVal)) xScaleObj.max = xMaxVal;
	if (!isNaN(yMinVal)) yScaleObj.min = yMinVal;
	if (!isNaN(yMaxVal)) yScaleObj.max = yMaxVal;

	timeChartInstance = new Chart(ctx, {
		type: 'line',
		data: { labels: labels, datasets: datasets }, // Wstrzyknięcie tablicy wielu serii wygenerowanej dynamicznie
		options: {
			responsive: true, maintainAspectRatio: false,
			stats: { decimation: { enabled: true, algorithm: 'lttb' } }, 
			interaction: { mode: 'index', intersect: false },
			scales: {
				x: xScaleObj,
				y: yScaleObj
			},
			plugins: {
				zoom: { 
					zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, 
					pan: { enabled: true, mode: 'x' } 
				},
				tooltip: { 
					backgroundColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#cbd5e1', borderColor: '#475569', borderWidth: 1, 
					callbacks: { title: function(c) { return `Czas: ${c[0].label} ms`; } } 
				}
			}
		}
	});
}

/**
 * Rysuje Wykres 3 (Przebieg interwałów czasowych procesora - Jitter).
 */
function drawJitterChart(labels, data) {
	const ctx = document.getElementById('jitterChart').getContext('2d');
	if (jitterChartInstance) jitterChartInstance.destroy(); // Zabezpieczenie przed wyciekiem pamięci RAM
	
	// Odczytanie ewentualnych ręcznych wartości granicznych osi wyznaczonych przez użytkownika
	const xMinVal = parseFloat(document.getElementById('jitterXMin').value);
	const xMaxVal = parseFloat(document.getElementById('jitterXMax').value);
	const yMinVal = parseFloat(document.getElementById('jitterYMin').value);
	const yMaxVal = parseFloat(document.getElementById('jitterYMax').value);

	const xScaleObj = Object.assign({ type: 'linear', title: { display: true, text: 'Czas od początku logu (ms)', color: '#cbd5e1' } }, darkScaleConfig);
	const yScaleObj = Object.assign({ title: { display: true, text: 'Czas wykonania pętli (ms)', color: '#cbd5e1' }, beginAtZero: isNaN(yMinVal) }, darkScaleConfig);

	if (!isNaN(xMinVal)) xScaleObj.min = xMinVal;
	if (!isNaN(xMaxVal)) xScaleObj.max = xMaxVal;
	if (!isNaN(yMinVal)) yScaleObj.min = yMinVal;
	if (!isNaN(yMaxVal)) yScaleObj.max = yMaxVal;

	jitterChartInstance = new Chart(ctx, {
		type: 'line',
		data: {
			labels: labels,
			datasets: [{
				label: 'Rzeczywisty interwał pętli (dt)',
				data: data,
				borderColor: '#c084fc', // Neonowy, fluorescencyjny fiolet gwarantujący idealną czytelność na czarnym tle
				backgroundColor: 'transparent',
				borderWidth: 1.2, pointRadius: 0, pointHoverRadius: 5
			}]
		},
		options: {
			responsive: true, maintainAspectRatio: false,
			interaction: { mode: 'index', intersect: false },
			scales: {
				x: xScaleObj,
				y: yScaleObj
			},
			plugins: {
				zoom: { 
					zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' }, 
					pan: { enabled: true, mode: 'x' } 
				},
				tooltip: { backgroundColor: '#1e293b', titleColor: '#f8fafc', bodyColor: '#cbd5e1', borderColor: '#475569', borderWidth: 1 }
			}
		}
	});
}

/* --- LOGIKA ZARZĄDZANIA RĘCZNYM SKALOWANIEM OSI (MANUAL AXIS LIMITS) --- */

function applyFFTAxisLimits() {
	processFFT();
}

function resetFFTAxisLimits() {
	document.getElementById('fftXMin').value = '';
	document.getElementById('fftXMax').value = '';
	document.getElementById('fftYMin').value = '';
	document.getElementById('fftYMax').value = '';
	processFFT();
	resetZoomFFT();
}

function applyTimeAxisLimits() {
	processTimeDomainAndStats();
}

function resetTimeAxisLimits() {
	document.getElementById('timeXMin').value = '';
	document.getElementById('timeXMax').value = '';
	document.getElementById('timeYMin').value = '';
	document.getElementById('timeYMax').value = '';
	processTimeDomainAndStats();
	resetZoomTime();
}

function applyJitterAxisLimits() {
	processJitterAnalysis();
}

function resetJitterAxisLimits() {
	document.getElementById('jitterXMin').value = '';
	document.getElementById('jitterXMax').value = '';
	document.getElementById('jitterYMin').value = '';
	document.getElementById('jitterYMax').value = '';
	processJitterAnalysis();
	resetZoomJitter();
}

// Proste funkcje wywoływane kliknięciem przycisków resetu: przywracają oryginalną skalę wykresu (100% szerokości logu) po zoomowaniu
function resetZoomFFT() { if (fftChartInstance) fftChartInstance.resetZoom(); }
function resetZoomTime() { if (timeChartInstance) timeChartInstance.resetZoom(); }
function resetZoomJitter() { if (jitterChartInstance) jitterChartInstance.resetZoom(); }

// Funkcja pomocnicza wstrzykująca tekst błędu do sekcji powiadomień
function showError(msg) { document.getElementById('errorLog').innerText = msg; }