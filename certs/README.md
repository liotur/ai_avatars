# Extra certificate authorities

Put certificate authority files here (`.pem` or `.crt`, PEM text) when the language model provider's certificate is signed by a company authority that a stock Linux image does not know. Amdocs AutoX is such a provider.

The demo container reads this folder at start and gives the certificates to the assistant. Nothing here is committed or copied into the image.

On a Mac that has the Amdocs certificates installed, this creates the file:

```bash
security find-certificate -a -c "Amdocs" -p /Library/Keychains/System.keychain > certs/amdocs-ca.pem
```

Then start the app again (`docker compose up -d`).

Without the file, the assistant answers a message with "Could not reach the provider" even though the network is fine.
