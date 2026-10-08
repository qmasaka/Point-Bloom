# Фото в сплаты (Apple SHARP) на своём компьютере

Локальный сервер отдаёт Point Bloom и запускает SHARP: на сайте появляется кнопка «Фото в сплаты».
Всё считается на вашем компьютере, модель на сайт не выкладывается (лицензия Apple разрешает только некоммерческие исследования).

- Запуск: иконка «Point Bloom SHARP» на рабочем столе или `bash ~/PointBloomSharp/start.sh`
- Остановка: `bash ~/PointBloomSharp/stop.sh`
- Установка SHARP: `~/PointBloomSharp/.venv` (Python 3.13, uv), веса в `~/.cache/torch/hub/checkpoints`
- Результаты: `~/PointBloomSharp/out/*.ply`
