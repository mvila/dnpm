# dnpm [![npm version](https://img.shields.io/npm/v/dnpm.svg)](https://www.npmjs.com/package/dnpm)

Like `npm` but fetches packages from a local directory rather than from the registry.

## Why?

Since years, I struggle with `npm` when it comes to work with in progress dependencies. The official solution is to use `npm link` but unfortunately it doesn't work that well when we start to use tools like [Babel](https://babeljs.io/) or [Browserify](http://browserify.org/).

So, what are the remaining options?

`npm update my-package` would be great but it fetches packages from the public registry which is far from ideal for a dev workflow.

`npm update /path/to/my-package` could be an option, but in case you are dealing with several packages, having to specify paths every time is really boring.

With `dnpm`, you can just do:

`dnpm update my-package` to install the last *local version* of `my-package` without having to specify any path. By default, `dnpm` will try to find a semantically compatible version from the parent directory.

## Installation

```
npm install -g dnpm
```

## Usage

```
dnmp <command> [packages...]
```

For now, the only implemented command is:

* `update`:  Update all (or listed) packages.

Options:

*  `-l`, `--local` *(default: `"../"`)*: Directory containing your local packages.
* `-S`, `--save`: Save version numbers in package.json.
* `--dev`: Include `devDependencies` packages.
* `-v`, `--verbose`: Make the output more verbose.
* `-h`, `--help`: Show help.

## Examples

Use `dnpm` as if you were using `npm`:

`dnpm update my-package` will update `my-package` to the last semantically compatible version found in the parent directory.

`dnpm update` will update all packages from those found in the parent directory.

`dnpm update --local=/path/to/your/packages` will update all packages from the specified directory.

## License

MIT
