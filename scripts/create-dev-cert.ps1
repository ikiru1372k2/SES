$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$certDir = Join-Path $root "certs"
$pfxPath = Join-Path $certDir "localhost.pfx"
$passwordText = "office-addin-dev"

New-Item -ItemType Directory -Force -Path $certDir | Out-Null

$password = ConvertTo-SecureString -String $passwordText -Force -AsPlainText
$cert = New-SelfSignedCertificate `
  -DnsName "localhost" `
  -FriendlyName "EffortWorkbookAuditorDev" `
  -CertStoreLocation "Cert:\CurrentUser\My" `
  -KeyExportPolicy Exportable `
  -KeyAlgorithm RSA `
  -KeyLength 2048 `
  -HashAlgorithm SHA256

Export-PfxCertificate `
  -Cert "Cert:\CurrentUser\My\$($cert.Thumbprint)" `
  -FilePath $pfxPath `
  -Password $password | Out-Null

Write-Host "Created $pfxPath"
Write-Host "Passphrase: $passwordText"
Write-Host "If Excel warns about trust, import the certificate into Current User > Trusted Root Certification Authorities."
