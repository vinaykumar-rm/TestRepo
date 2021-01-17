
docker network create --attachable --subnet=10.8.128.0/17 testnetwork
docker stack deploy -c docker-compose-server.yml test