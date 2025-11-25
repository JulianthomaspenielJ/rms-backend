const fs = require('fs');
const path = require('path');

const modelsDir = path.join(__dirname, 'models');
console.log('Models directory exists:', fs.existsSync(modelsDir));
console.log('Models directory contents:');
if (fs.existsSync(modelsDir)) {
  console.log(fs.readdirSync(modelsDir));
}
