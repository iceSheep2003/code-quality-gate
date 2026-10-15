# Distribution

## npm and npx

Code Quality Gate is a Node CLI with a `bin` entry. Publish it to npm once and users can install it or execute it through npx. npx is an npm package runner, not a separate registry.

```sh
npm install --save-dev code-quality-gate@0.5.1
npx code-quality-gate setup
npx code-quality-gate audit
```

For a one-off execution after publication:

```sh
npx --yes code-quality-gate@0.5.1 audit --root /path/to/project
```

The package is currently prepared for publication. npm commands above become available after an actual successful registry publish; an available name is not a reservation. `code-quality` remains an executable alias for earlier local consumers.

## First publication

The publisher needs an npm account with email verification, package-publishing permissions and the authentication required by npm. Run these commands locally:

```sh
npm login
npm whoami
npm publish --dry-run
npm publish --access public
```

`prepublishOnly` runs tests, formatting and the source quality gate before publishing. `files` explicitly lists distributed content, and package versions cannot be overwritten after publication. Inspect `npm pack --dry-run` before every release.

The package name, GitHub repository links, MIT license, CLI entry and publication metadata are configured in package.json. No npm token is stored in the repository. Use a unique new version for subsequent releases.

## Subsequent GitHub releases

`.github/workflows/publish.yml` is a manually triggered workflow that validates and publishes the package. It uses Node 24 and npm trusted publishing via OIDC. Before running it:

1. Publish the initial package using your npm account, then open the package's npm settings.
2. Add a GitHub Actions trusted publisher for owner `iceSheep2003`, repository `code-quality-gate`, workflow filename `publish.yml`; permit direct publishing.
3. Select the package version to publish in package.json, commit it and run the workflow from GitHub Actions.

The workflow has `id-token: write`, which the registry needs for OIDC. No long-lived publish token is required. npm trusted publishing requires npm 11.5.1+ and Node 22.14.0+; the workflow uses Node 24 with an explicit npm minimum check. Registry ownership and trusted-publisher setup remain account operations.

The repository is public. The workflow publishes with provenance so consumers can verify the source workflow after the npm trusted publisher is configured.

## GitHub source and release archives

Authenticated users can install the tagged source before npm publication:

```sh
npm install --save-dev github:iceSheep2003/code-quality-gate#v0.5.1
```

The generated host-project CI template installs the matching tagged GitHub source and does not require an npm release. The repository is public. A `.tgz` generated with `npm pack` can also be installed directly:

```sh
npm install --save-dev ./code-quality-gate-0.5.1.tgz
```

## pip / pipx / uv

The code under test can be Python without installing Code Quality Gate through pip. Python's test runner is simply one of the commands it invokes.

A PyPI distribution would require a maintained Python launcher plus a way to supply the Node runtime and JavaScript dependencies, or a separate native/Python implementation. A launcher that quietly downloads an unpinned npm package would add another dependency chain and authentication path. The current release therefore ships through npm/GitHub only; `pip install code-quality-gate` and `pipx run code-quality-gate` are not advertised as working commands.

If Python-only installation becomes a requirement, version and test the wrapper as a separate distribution, pin its JavaScript payload, verify its integrity and publish via PyPI's trusted-publisher mechanism. It should invoke the same gate protocol and preserve exit codes and reports.

## References

README structure was reviewed against [ESLint](https://github.com/eslint/eslint#readme) and [Ruff](https://github.com/astral-sh/ruff#readme). Release guidance follows [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/), [npm exec / npx](https://docs.npmjs.com/cli/v11/commands/npm-exec/) and [npm publish](https://docs.npmjs.com/cli/v11/commands/npm-publish/).
