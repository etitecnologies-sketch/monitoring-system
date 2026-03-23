#!/bin/sh
# Inicia o monitor principal e o monitor solar em paralelo
python main.py &
python solar_monitor.py &
wait
