# Deploy

O ambiente de producao usa o Docker Compose deste repositorio no Coolify.
Todo push para a branch `main` aciona um novo deploy por webhook do GitHub.
Pushes para outras branches nao alteram o ambiente de producao.

Antes de publicar, execute:

```bash
npm run lint
npm test
```
