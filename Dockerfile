# Serve the static PWA with nginx. Build & run on Docker Desktop:
#   docker build -t look-inventory .
#   docker run -p 8080:80 look-inventory
# then open http://localhost:8080
FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY . /usr/share/nginx/html
EXPOSE 80
