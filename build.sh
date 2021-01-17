#!/bin/bash

version=$1
docker build . -t vinayumar:$version

docker push vinayumar:$version