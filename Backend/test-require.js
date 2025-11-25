const path = require('path');

console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);

// Try different ways to require the AWS module
const pathsToTry = [
  './config/AWS',
  path.join(__dirname, 'config', 'AWS'),
  path.resolve(__dirname, 'config', 'AWS.js')
];

pathsToTry.forEach((modulePath, index) => {
  console.log(`\nAttempt ${index + 1}: require('${modulePath}')`);
  try {
    const module = require(modulePath);
    console.log('✅ Successfully required module:', Object.keys(module));
  } catch (error) {
    console.error('❌ Failed to require module:', error.message);
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('  - Path:', require.resolve(modulePath, { paths: [__dirname] }));
    }
  }
});
