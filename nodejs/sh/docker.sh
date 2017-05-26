#!/bin/bash

# Builds a Docker Image.
# Expects the following environment variables;
#
#   docker_path: << Path to the docker directory >>
#   docker_registry: << Docker registry server >>
#   docker_user: << Name of the Docker user in registry >>
#   docker_pass: << Name of registry user password >>
#   docker_tag: << Tag name of image >>
#

echo docker_path: $docker_path
echo docker_registry: $docker_registry
echo docker_user: $docker_user
echo docker_tag: $docker_tag

# Login to the registry,
# SECURITY NOTE: We are putting username and password for Docker
#    registry into process string. There doesn't appear to be a
#    more secure way to do this.

docker login $docker_registry -u $docker_user -p $docker_pass

if [ $? != 0 ]; then
  echo 'ERROR: Docker Registry Login Failed'
  exit $?
fi

# Build image with Docker

docker build --tag $docker_tag $docker_path

if [ $? != 0 ]; then
  echo 'ERROR: Docker Build Failed'
  exit $?
fi

# And push it,

docker push $docker_tag

if [ $? != 0 ]; then
  echo 'ERROR: Docker Registry Push Failed'
  exit $?
fi
