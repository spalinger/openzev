# Django owns forwarded HTTPS detection through NUM_PROXIES. Gunicorn must not
# independently turn client headers into wsgi.url_scheme=https: that would
# bypass Django's SECURE_PROXY_SSL_HEADER=None when no proxy is trusted.
secure_scheme_headers = {}
