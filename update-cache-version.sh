#!/bin/bash

# Get current date in YYYYMMDD format
VERSION=$(date +%Y%m%d%H%M%S)

# Update CSS link in index.html
sed -i "s/styles\.css?v=[0-9]*/styles.css?v=$VERSION/g" index.html

# Update JS script in index.html
sed -i "s/main\.js?v=[0-9]*/main.js?v=$VERSION/g" index.html

echo "Cache version updated to: $VERSION"