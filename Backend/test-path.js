const path = require('path');

console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);
console.log('Trying to require AWS from:', path.join(__dirname, 'config', 'AWS.js'));

try {
  const aws = require(path.join(__dirname, 'config', 'AWS'));
  console.log('Successfully required AWS module');
} catch (error) {
  console.error('Error requiring AWS module:', error);
}
