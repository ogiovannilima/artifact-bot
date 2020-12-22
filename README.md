# artifact-bot

> A GitHub App built with [Probot](https://github.com/probot/probot) that artifact-bot

## Setup

```sh
# Install dependencies
npm install

# Compile
npm run build

# Run
npm run start
```

## Docker

```sh
# 1. Build container
docker build -t artifact-bot .

# 2. Start container
docker run -e APP_ID=<app-id> -e PRIVATE_KEY=<pem-value> artifact-bot
```

## Contributing

If you have suggestions for how artifact-bot could be improved, or want to report a bug, open an issue! We'd love all and any contributions.

For more, check out the [Contributing Guide](CONTRIBUTING.md).

## License

[ISC](LICENSE) © 2020 developer-experience 

## anotacoes
alterar permissoes de content, Webhooks, Commit statuses para write&Read 
