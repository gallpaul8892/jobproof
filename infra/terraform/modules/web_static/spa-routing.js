// CloudFront Function (viewer-request) for the S3 (default) behaviour ONLY.
// A path without a file extension is a single-page-app route: serve /index.html and let the
// router take over. Paths with an extension (/assets/x.js, /config.js, /favicon.ico) are left
// alone, so a missing asset stays a real 404.
//
// This replaces distribution-wide custom error pages on purpose: those would also rewrite the
// API's problem+json 403 and 404 responses into HTML (spec section 2). /api/* and /health use
// other behaviours that never run this function; the guard below is belt and braces.
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  if (uri === '/api' || uri.indexOf('/api/') === 0 || uri === '/health' || uri.indexOf('/health/') === 0) {
    return request;
  }

  var lastSegment = uri.substring(uri.lastIndexOf('/') + 1);
  if (lastSegment.indexOf('.') === -1) {
    request.uri = '/index.html';
  }
  return request;
}
