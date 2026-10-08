#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Локальный сервер: отдаёт Point Bloom и запускает Apple SHARP (фото в 3D-сплаты) на вашем компьютере.

Запуск:  python3 server.py   (порт 8777). Сайт сам находит этот сервер и показывает кнопку «Фото в сплаты».
Модель SHARP по лицензии Apple годится только для некоммерческих исследований и остаётся у вас на диске.
"""
import json
import os
import re
import subprocess
import sys
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

HERE = os.path.dirname(os.path.abspath(__file__))
SITE = os.path.abspath(os.path.join(HERE, '..', '..'))
HOME = os.path.expanduser('~/PointBloomSharp')
SHARP = os.path.join(HOME, '.venv', 'bin', 'sharp')
UPLOADS = os.path.join(HOME, 'uploads')
OUT = os.path.join(HOME, 'out')
PORT = int(os.environ.get('PORT', '8777'))
LOCK = threading.Lock()
os.makedirs(UPLOADS, exist_ok=True)
os.makedirs(OUT, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=SITE, **kw)

    def log_message(self, fmt, *args):
        sys.stderr.write('%s\n' % (fmt % args))

    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/sharp/status':
            return self._json(200, {'ready': os.path.exists(SHARP), 'busy': LOCK.locked()})
        if path.startswith('/sharp-out/'):
            name = os.path.basename(unquote(path))
            fp = os.path.join(OUT, name)
            if not os.path.isfile(fp):
                return self._json(404, {'error': 'нет файла'})
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(os.path.getsize(fp)))
            self.end_headers()
            with open(fp, 'rb') as f:
                while True:
                    chunk = f.read(1 << 20)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
            return
        # файлы сайта не кэшируем: после обновления страница сразу берёт свежую версию
        return super().do_GET()

    def end_headers(self):
        if not self.path.startswith('/sharp-out/'):
            self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def do_POST(self):
        if self.path.split('?')[0] != '/sharp/predict':
            return self._json(404, {'error': 'нет такого адреса'})
        if not os.path.exists(SHARP):
            return self._json(500, {'error': 'SHARP не установлен в ' + HOME})
        n = int(self.headers.get('Content-Length') or 0)
        if n <= 0 or n > 80 * 1024 * 1024:
            return self._json(400, {'error': 'Файл пустой или больше 80 МБ'})
        data = self.rfile.read(n)
        orig = unquote(self.headers.get('X-Filename') or 'photo.jpg')
        stem = re.sub(r'[^\w\-]+', '_', os.path.splitext(orig)[0], flags=re.U).strip('_') or 'photo'
        ext = os.path.splitext(orig)[1].lower()
        if ext not in ('.jpg', '.jpeg', '.png', '.heic', '.heif', '.webp', '.bmp', '.tif', '.tiff'):
            ext = '.jpg'
        key = '%s_%d' % (stem, int(time.time()))
        src = os.path.join(UPLOADS, key + ext)
        with open(src, 'wb') as f:
            f.write(data)
        with LOCK:
            out_dir = os.path.join(OUT, key)
            os.makedirs(out_dir, exist_ok=True)
            t0 = time.time()
            try:
                r = subprocess.run([SHARP, 'predict', '-i', src, '-o', out_dir], capture_output=True, text=True, timeout=900)
            except subprocess.TimeoutExpired:
                return self._json(504, {'error': 'SHARP считал слишком долго'})
        plys = [f for f in os.listdir(out_dir) if f.endswith('.ply')]
        if r.returncode != 0 or not plys:
            return self._json(500, {'error': 'SHARP не смог обработать фото', 'log': (r.stderr or r.stdout)[-800:]})
        final = key + '.ply'
        os.replace(os.path.join(out_dir, plys[0]), os.path.join(OUT, final))
        return self._json(200, {'url': '/sharp-out/' + final, 'name': stem, 'seconds': round(time.time() - t0, 1)})


if __name__ == '__main__':
    srv = ThreadingHTTPServer(('127.0.0.1', PORT), Handler)
    print('Point Bloom + SHARP: http://127.0.0.1:%d/' % PORT, flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass
