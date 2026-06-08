require('dotenv').config();

async function testEmailService() {
  console.log('🧪 Testing mailer service configuration...\n');
  
  // Check required environment variables
  const requiredVars = ['MAILER_API_KEY'];
  const optionalVars = {
    'RESEND_API_KEY': 'Resend (recommended for Render free tier)',
    'SMTP_USER': 'Gmail SMTP (requires paid Render plan)',
    'SENDGRID_API_KEY': 'SendGrid',
    'RESEND_FROM_EMAIL': 'Resend from email',
    'SMTP_PASS': 'Gmail app password',
    'SENDGRID_FROM': 'SendGrid from email'
  };
  
  console.log('📋 Required variables:');
  requiredVars.forEach(varName => {
    const value = process.env[varName];
    if (value) {
      console.log(`✅ ${varName}: ${value.substring(0, 3)}***`);
    } else {
      console.log(`❌ ${varName}: NOT SET`);
    }
  });
  
  console.log('\n📋 Optional variables:');
  Object.entries(optionalVars).forEach(([varName, description]) => {
    const value = process.env[varName];
    if (value) {
      console.log(`✅ ${varName} (${description}): ${value.substring(0, 3)}***`);
    } else {
      console.log(`⚪ ${varName} (${description}): NOT SET`);
    }
  });
  
  // Check provider priority
  const priority = process.env.MAILER_PROVIDERS_PRIORITY || 'gmail';
  console.log(`\n🔄 Provider priority: ${priority}`);
  
  // Determine which providers are configured
  const providers = {
    gmail: !!(process.env.SMTP_USER && process.env.SMTP_PASS),
    resend: !!process.env.RESEND_API_KEY,
    sendgrid: !!process.env.SENDGRID_API_KEY
  };
  
  console.log('\n🚀 Available providers:');
  Object.entries(providers).forEach(([provider, available]) => {
    console.log(`${available ? '✅' : '❌'} ${provider}`);
  });
  
  const availableProviders = Object.entries(providers)
    .filter(([, available]) => available)
    .map(([provider]) => provider);
  
  if (availableProviders.length === 0) {
    console.log('\n❌ No email providers configured!');
    console.log('Please configure at least one provider (RESEND_API_KEY, SMTP_USER+SMTP_PASS, or SENDGRID_API_KEY)');
    return;
  }
  
  console.log(`\n✅ Service configured with ${availableProviders.length} provider(s): ${availableProviders.join(', ')}`);
  
  // Test actual email sending (optional)
  if (process.argv.includes('--send-test')) {
    console.log('\n📧 Sending test email...');
    
    try {
      const response = await fetch('http://localhost:10000/send', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.MAILER_API_KEY
        },
        body: JSON.stringify({
          to: 'test@example.com',
          subject: 'Test Email from Mailer Service',
          html: '<h1>Test Email</h1><p>This is a test email from the mailer service.</p>'
        })
      });
      
      if (response.ok) {
        const result = await response.json();
        console.log('✅ Test email sent successfully:', result);
      } else {
        const error = await response.text();
        console.log('❌ Test email failed:', error);
      }
    } catch (err) {
      console.log('❌ Test email error:', err.message);
    }
  }
}

if (require.main === module) {
  testEmailService().catch(console.error);
}

module.exports = testEmailService;
