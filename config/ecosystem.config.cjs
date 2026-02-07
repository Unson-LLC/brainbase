const fs = require('fs');
const path = require('path');

// Read .env file manually
const envPath = path.join(__dirname, '.env');
const envConfig = {};

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim();
      envConfig[key] = value;
    }
  });
}

module.exports = {
  apps: [
    {
      name: 'brainbase',
      script: './server.js',
      env: {
        NODE_ENV: 'development',
        PORT: 31013,
        BRAINBASE_ROOT: envConfig.BRAINBASE_ROOT,
        PROJECTS_ROOT: envConfig.PROJECTS_ROOT,
        NOCODB_BASE_URL: envConfig.NOCODB_BASE_URL,
        NOCODB_API_TOKEN: envConfig.NOCODB_API_TOKEN
      }
    }
  ]
};
