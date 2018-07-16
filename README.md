# github-auth-store

## usage

`npm install @mironal/github-auth-store`

```ts
const store = new GitHubTokenStore(
    "~/.your-app/token"
)

if (store.exists()) {
    store.readToken().then(token => console.log(token)).catch(error => console.error(error))
} else {
    store.authenticate("username", "password", {
        note:"some note"
    }).then(() => {
        console.log(store.exists())
        // true
    })
}

```