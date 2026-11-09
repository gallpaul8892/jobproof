# certs

`rds-global-bundle.pem` is the public AWS RDS certificate authority bundle used for TLS
`verify-full` connections to RDS (INFRA spec 5.2). It contains no secret.

**Status: placeholder.** Replace it with
https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem (about 100 certificates).
`backend/tests/test_rds_bundle.py` reports the placeholder as an expected failure (XFAIL) and
enforces the real bundle's shape once it is in place. The backend refuses to start in staging or
production while the bundle has no valid certificate.
