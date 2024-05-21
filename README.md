Based on the provided homepage text, here is the updated README with relevant sections:

# ODI Care Tool

The ODI Care Tool is designed to help organisations think about the potential impact of their product or service on people and society through Consequence Scanning. This interactive tool provides a framework to carry out a Consequence Scanning activity and generate a risk register that can be downloaded and incorporated into your project planning and governance.

## Dependencies

- OAuth credentials for Google and Django
- MongoDB (for storing user and token records)
- OpenAI - For using AI to assist form completion
- Node.js
- Express.js
- Passport.js
- Mongoose

## Installation and Setup

1. Clone this repository to your local machine.
2. Install dependencies using `npm install`.
3. Create a `config.env` file in the root directory based on the provided `config.env.example` file. Fill in the required environment variables.
4. Start the server using `npm start`.
5. Access the server at `http://localhost:3080`.

## Usage

- Visit `http://localhost:3080/` and login.
- Use the interactive tool to conduct a Consequence Scan by selecting from example case studies or starting a new project.
- Document potential outcomes to mitigate or address potential harms or disasters before they happen.
- Generate and download a risk register to incorporate into your project planning and governance.

## Features

### Supported by AI

The tool uses a ChatGPT plugin to assist you in the process of Consequence Scanning. Throughout the tool, you will have the option to generate suggestions and ideas for your project to help you identify consequences and plan risk mitigation.

The tool will:
- **Analyse data**: The AI reads and analyses the content you input, including project descriptions, data details, and stakeholder information.
- **Suggest consequences**: Based on this analysis, the AI suggests potential consequences, both positive and negative, that might arise from your data project.
- **Assess risk**: The tool will assess the impact and likelihood of these consequences to help you prioritize and manage risks effectively.
- **Create actions**: The AI will generate specific actions to mitigate and manage identified consequences.
- **Recommend KPIs**: The tool will also recommend Key Performance Indicators (KPIs) for your actions in order to track the effectiveness of your risk mitigation actions.

Please note: Suggestions from the AI assistant are provided for consideration and should be taken as presented.

## Contributing

Feel free to contribute to this project by opening issues or pull requests on GitHub.

## License

This project is licensed under the MIT License. See the [LICENSE.md](LICENSE.md) file for details.