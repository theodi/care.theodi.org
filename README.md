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
3. Create a `config.env` file in the root directory based on the provided `config.env.example` file. Fill in the required environment variables, including the HubSpot API key and the limit for the number of free projects.
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
- **Recommend KPIs**: The tool will also recommend Key Performance Indicators (KPIs) for your actions to track the effectiveness of your risk mitigation actions.

Please note: Suggestions from the AI assistant are provided for consideration and should be taken as presented.

### Authentication Methods

1. **Google Authentication**:
   - Provides admin access.
   - Admins have additional privileges, including the ability to change the local account password.
   - Once logged in with Google, an option to change the local password will appear in the navigation tool bar.

2. **Django Authentication**:
   - Represents users with accounts on the ODI website.
   - These users have access to the tool based on their ODI membership.

3. **Local Accounts**:
   - Equivalent to free accounts and are limited to the FREE_PROJECT_LIMIT.
   - These accounts are designed for short-term use and demonstrations.

### Local Login for Test Accounts

The ODI Care Tool provides a local login feature for test accounts to facilitate easy demonstration and testing of the tool without requiring OAuth logins. Here's how it works:

- **Local Accounts Creation**: Local accounts can be created using a predefined password that is set for all test accounts. These accounts are intended for short-term use and demonstrations.
- **Password Reset**: The default password for local accounts can be reset through a secure form accessible after logging in with Google authentication. This reset process will also delete all existing local accounts and associated projects to ensure a clean slate for new demonstrations.
- **Daily Cleanup**: All local accounts and their associated projects are automatically deleted every day at 03:30 UTC. This cleanup ensures that local accounts are only used temporarily and do not persist beyond their intended short-term use.

#### Using the Local Login Feature

1. **Access the Reset Password Page**:
   - Login with Google authentication to access the reset password option in the navigation tool bar.
   - Navigate to the reset password page to view and change the current default password for local accounts.
   - The current password is displayed on this page, and you can set a new password that will be applied to all local accounts.

2. **Resetting the Password**:
   - Enter and confirm the new password.
   - Upon submission, the current password will be updated, and all existing local accounts and projects will be deleted.
   - The new password will then be used for any new local account logins.

3. **Automatic Daily Deletion**:
   - Every day at 03:30 UTC, a scheduled task will run to delete all local accounts and their associated projects. This ensures that any test data does not persist longer than necessary.

### HubSpot Integration (ODI ONLY!)

The ODI Care Tool integrates with the ODI HubSpot to manage user memberships and track tool usage statistics. Ensure you have a valid HubSpot API key and set it in the `config.env` file. You can also set the FREE_PROJECT_LIMIT. This enables anyone to use the tool who has an account, no valid membership is required.

## Contributing

Feel free to contribute to this project by opening issues or pull requests on GitHub.

## License

This project is licensed under the MIT License. See the [LICENSE.md](LICENSE.md) file for details.