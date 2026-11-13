# Analizator_FFT
Analizator FFT z logów Blackboxa

Link do strony:  https://dariusz90.github.io/Analizator_FFT/

## Zakres czasu analizy

W głównym panelu można wpisać początek i koniec analizowanego zakresu w sekundach liczonych od początku logu (np. `1.001`), a następnie wybrać **Zastosuj zakres czasu**. Granice są włączne; puste pole pozostawia odpowiednio początek lub koniec logu bez ograniczenia. Wybrany zakres obejmuje FFT, wykresy, statystyki i analizę jitteru. **Pokaż cały log** czyści obie granice.

W standardowym trybie czas od początku logu wyliczany jest względem pierwszego poprawnego znacznika z kolumny `Timestamp`, więc wpisywane wartości nie zależą od samego Timestamp. Przy ręcznej częstotliwości próbkowania czas jest wyznaczany od 0 s na podstawie wpisanego Hz.

Na wykresie przebiegów czasowych aplikacja szacuje opóźnienie dla dwóch pierwszych zaznaczonych sygnałów metodą korelacji krzyżowej. Wynik jest dodatni, gdy drugi sygnał jest opóźniony względem pierwszego. Współczynnik korelacji i rozdzielczość oszacowania są wyświetlane obok wyniku.
