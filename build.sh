#! /bin/bash

version=$1

sed -i "s/@@BUILDNUMBER@@/$version" index.html
docker build . -t vinaykumar/nginx:$version



#docker push docker.io/vinaykumar/nginx:$version