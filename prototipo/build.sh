#!/bin/sh
# Genera index.html (página completa) a partir de app.html, que es el fragmento publicado como Artifact.
cd "$(dirname "$0")"
{
  printf '<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
  printf '<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="mobile-web-app-capable" content="yes">\n<meta name="apple-mobile-web-app-title" content="FisioCerca">\n<meta name="theme-color" content="#40739F">\n'
  printf '</head>\n<body>\n'
  cat app.html
  printf '\n</body>\n</html>\n'
} > index.html
