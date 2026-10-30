require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGemini() {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

  if (!apiKey) {
    console.error('❌ Error: GEMINI_API_KEY is not set in .env');
    process.exit(1);
  }

  const maskedKey = apiKey.slice(0, 8) + '...' + apiKey.slice(-4);
  console.log(`Testing Gemini API connection...`);
  console.log(`API Key: ${maskedKey}`);
  console.log(`Model:   ${modelName}\n`);

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });

    const result = await model.generateContent('Say "Gemini AI connection successful!" in 5 words or less.');
    const response = await result.response;
    const text = response.text().trim();

    console.log('✅ Response received:');
    console.log(text);
    console.log('\n🎉 Gemini AI is working correctly!');
  } catch (err) {
    console.error('\n❌ Gemini API Error:', err.message || err);
    if (err.cause) {
      console.error('Detailed cause:', err.cause);
    }
    process.exit(1);
  }
}

testGemini();

