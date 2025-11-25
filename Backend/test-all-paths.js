const path = require('path');

console.log('Testing all module paths...');
console.log('Current working directory:', process.cwd());
console.log('__dirname:', __dirname);

const modulesToTest = [
  // Main controllers
  { name: 'authController', path: './controllers/authController' },
  { name: 'feedbackController', path: './controllers/feedbackController' },
  { name: 'supportController', path: './controllers/supportController' },
  
  // Sub admin
  { name: 'subAdminController', path: './controllers/subAdmin/subAdminController' },
  
  // Super admin
  { name: 'superAdminController', path: './controllers/superAdmin/superAdminController' },
  { name: 'dashboardController', path: './controllers/superAdmin/dashboardController' },
  
  // Models
  { name: 'userModel', path: './models/userModel' },
  { name: 'companyModel', path: './models/companyModel' },
  { name: 'feedbackModel', path: './models/feedbackModel' },
  { name: 'supportTicketModel', path: './models/supportTicketModel' },
  { name: 'supportMessageModel', path: './models/supportMessageModel' },
  { name: 'loginLogModel', path: './models/loginLogModel' }
];

console.log('\nTesting module paths...');
modulesToTest.forEach(module => {
  try {
    const modulePath = path.resolve(__dirname, module.path);
    require(modulePath);
    console.log(`✅ ${module.name} loaded successfully from ${module.path}`);
  } catch (error) {
    console.error(`❌ Failed to load ${module.name} from ${module.path}:`, error.message);
    console.error('  Error details:', {
      code: error.code,
      requireStack: error.requireStack || 'N/A'
    });
  }
});

console.log('\nTesting AWS module...');
try {
  const aws = require('./config/AWS');
  console.log('✅ AWS module loaded successfully');
  console.log('  Exports:', Object.keys(aws));
} catch (error) {
  console.error('❌ Failed to load AWS module:', error.message);
}
