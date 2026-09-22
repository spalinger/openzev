#!/bin/sh
set -e

python manage.py migrate

gunicorn config.wsgi:application --config /app/gunicorn.conf.py --bind 127.0.0.1:8000 --workers "${GUNICORN_WORKERS:-3}" --forwarded-allow-ips "${GUNICORN_FORWARDED_ALLOW_IPS:-127.0.0.1}" --access-logfile - --access-logformat '%({x-forwarded-for}i)s %(l)s %(u)s %(t)s "%(m)s %(U)s %(H)s" %(s)s %(b)s "%(a)s"' &

if [ "${RUN_CELERY_IN_APP:-0}" = "1" ]; then
  celery -A config worker -l info &
fi

exec nginx -g 'daemon off;'
