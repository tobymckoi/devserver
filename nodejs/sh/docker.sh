#!/bin/bash

# Builds a Docker Image.
# Expects the following environment variables;
#
#   repo_path: << Path to the repository directory >>
#   docker_registry: << Docker registry server >>
#   docker_user: << Name of the Docker user in registry >>
#   docker_pass: << Name of registry user password >>
#   docker_tag: << Tag name of image >>
#

echo repo_path: $repo_path
echo docker_registry: $docker_registry
echo docker_user: $docker_user
echo docker_tag: $docker_tag
