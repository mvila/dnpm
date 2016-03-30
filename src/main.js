'use strict';

import fs from 'fs';
import pathModule from 'path';
import childProcess from 'child_process';
import yargs from 'yargs';
import semver from 'semver';
import isEqual from 'lodash.isequal';
import fstream from 'fstream-npm';

let argv = yargs
  .usage('Usage: dnmp <command> [packages...]')
  .demand(1)
  .command('update', 'Update all (or listed) packages')
  .alias('l', 'local')
  .default('l', '../')
  .describe('l', 'Directory containing your local packages')
  .boolean('S')
  .alias('S', 'save')
  .describe('S', 'Save version numbers in package.json')
  .boolean('dev')
  .describe('dev', 'Include devDependencies packages')
  .boolean('v')
  .alias('v', 'verbose')
  .describe('v', 'Make the output more verbose')
  .help('h')
  .alias('h', 'help')
  .argv;

argv.command = argv._[0];
argv.packages = argv._.slice(1);

if (!Array.isArray(argv.local)) argv.local = [argv.local];

const WORKING_DIR = '.';
const CURRENT_PACKAGE_PATH = pathModule.join(WORKING_DIR, 'package.json');

let currentPackage;

async function getCurrentPackage() {
  if (currentPackage) return currentPackage;
  if (!fs.existsSync(CURRENT_PACKAGE_PATH)) {
    throw new Error('current package.json not found');
  }
  currentPackage = fs.readFileSync(CURRENT_PACKAGE_PATH, 'utf8');
  currentPackage = JSON.parse(currentPackage);
  return currentPackage;
}

async function saveCurrentPackage() {
  let str = JSON.stringify(currentPackage, null, 2) + '\n';
  fs.writeFileSync(CURRENT_PACKAGE_PATH, str);
}

let localPackages;

async function getLocalPackages() {
  if (localPackages) return localPackages;

  let dirs = [];

  for (let dir of argv.local) {
    let paths = fs.readdirSync(dir);
    for (let path of paths) {
      path = pathModule.resolve(dir, path);
      if (!fs.statSync(path).isDirectory()) continue;
      if (!dirs.includes(path)) dirs.push(path);
    }
  }

  localPackages = [];

  for (let dir of dirs) {
    let path = pathModule.join(dir, 'package.json');
    if (!fs.existsSync(path)) continue;
    let pkg = fs.readFileSync(path, 'utf8');
    pkg = JSON.parse(pkg);
    localPackages.push({ path: dir, pkg });
  }

  return localPackages;
}

function fetchPackageContent(path) {
  return new Promise(function(resolve, reject) {
    let files = [];
    let pkg;
    fstream({ path })
      .on('entry', function(entry) {
        let props = entry.props;
        if (props.basename !== 'package.json' && props.basename !== '.gitignore' && props.basename !== '.npmignore') {
          let filePath = pathModule.relative(path, props.path);
          files.push({ path: filePath, modifiedTime: props.mtime });
        }
      })
      .on('package', function(obj) {
        pkg = obj;
      })
      .on('error', function(err) {
        reject(err);
      })
      .on('end', function() {
        resolve({ path, files, pkg });
      });
  });
}

async function getLocalDependencies() {
  let currentPackage = await getCurrentPackage();

  function getDependencies(dependencies) {
    let results = [];
    if (dependencies) {
      for (let name of Object.keys(dependencies)) {
        if (argv.packages.length && !argv.packages.includes(name)) continue;
        let version = dependencies[name];
        results.push({ name, version });
      }
    }
    return results;
  }

  let dependencies = getDependencies(currentPackage.dependencies);
  if (argv.dev) {
    let devDependencies = getDependencies(currentPackage.devDependencies);
    dependencies = dependencies.concat(devDependencies);
  }

  let localDependencies = [];

  let localPackages = await getLocalPackages();
  for (let dependency of dependencies) {
    let localPackage = localPackages.find((localPackage) => {
      if (localPackage.pkg.name !== dependency.name) return false;
      return semver.satisfies(localPackage.pkg.version, dependency.version);
    });
    if (localPackage) localDependencies.push(localPackage);
  }

  return localDependencies;
}

async function packageIsUpToDate(source, target) {
  let sourceContent = await fetchPackageContent(source);
  let sourcePackage = sourceContent.pkg;

  if (!fs.existsSync(target)) return false;

  let targetPackagePath = pathModule.join(target, 'package.json');
  if (!fs.existsSync(targetPackagePath)) return false;

  let targetPackage = fs.readFileSync(targetPackagePath, 'utf8');
  targetPackage = JSON.parse(targetPackage);

  if (sourcePackage.version !== targetPackage.version) return false;

  let sourceDependencies = sourcePackage.dependencies || {};
  let targetDependencies = targetPackage.dependencies || {};
  if (!isEqual(sourceDependencies, targetDependencies)) {
    if (argv.verbose) {
      console.log('Source and target dependencies are different');
      console.log('Source:', sourceDependencies);
      console.log('Target:', targetDependencies);
    }
    return false;
  }

  for (let file of sourceContent.files) {
    let sourceModifiedTime = file.modifiedTime;
    let targetPath = pathModule.join(target, file.path);
    if (!fs.existsSync(targetPath)) {
      if (argv.verbose) {
        console.log('Missing target file: ' + targetPath);
      }
      return false;
    }
    let targetStats = fs.statSync(targetPath);
    let targetModifiedTime = targetStats.mtime;
    if (sourceModifiedTime.valueOf() !== targetModifiedTime.valueOf()) return false;
  }

  return true;
}

async function getOutdatedDependencies() {
  let outdatedDependencies = [];

  let localDependencies = await getLocalDependencies();
  for (let localDependency of localDependencies) {
    let a = localDependency.path;
    let b = pathModule.resolve(WORKING_DIR, 'node_modules', localDependency.pkg.name);
    if (!(await packageIsUpToDate(a, b))) outdatedDependencies.push(localDependency);
  }

  return outdatedDependencies;
}

async function installDependencies(dependencies) {
  let paths = dependencies.map(dependency => {
    return pathModule.relative('.', dependency.path);
  });
  paths = paths.map(path => '"' + path + '"');
  paths = paths.join(' ');
  let cmd = `npm install ${paths}`;
  if (argv.verbose) {
    console.log(cmd);
  }
  childProcess.execSync(cmd, { stdio: 'inherit' });
}

async function saveVersionNumbers(dependencies) {
  let currentPackage = await getCurrentPackage();
  let modified = false;

  function setVersionNumber(dependencies, { name, version }) {
    let currentVersion = dependencies[name];
    if (!currentVersion) return;
    version = '^' + version;
    if (currentVersion === version) return;
    dependencies[name] = version;
    modified = true;
  }

  for (let dependency of dependencies) {
    setVersionNumber(currentPackage.dependencies, dependency.pkg);
    if (argv.dev) {
      setVersionNumber(currentPackage.devDependencies, dependency.pkg);
    }
  }

  if (modified) await saveCurrentPackage();
}

async function update() {
  let outdatedDependencies = await getOutdatedDependencies();
  if (!outdatedDependencies.length) return;

  await installDependencies(outdatedDependencies);

  if (argv.save) {
    await saveVersionNumbers(outdatedDependencies);
  }
}

async function run() {
  if (argv.command === 'update') {
    await update();
  } else {
    console.error(`The command "${argv.command}" is unkwnown`);
  }
}

run().catch(console.error.bind(console));
