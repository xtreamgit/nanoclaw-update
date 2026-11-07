# Remove Microsoft mail

The broker code stays in this fork. Removal stops the process and deletes the local credential file.

1. Stop the process that is running `pnpm run mail-broker` or `node dist/microsoft-mail/main.js`. If it is a systemd unit, disable that unit.
2. Delete the env file that holds `MICROSOFT_MAIL_TOKEN`, the certificate paths, and the client secret. Delete the certificate and private key if they were created only for this broker.
3. Remove the broker URL and local token from every agent group's instructions and container environment.
4. In the client's Entra tenant, remove the app registration or its admin consent when Microsoft mail should no longer be available.
