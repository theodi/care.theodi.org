# DEVELOPER.md

## Introduction

The ODI Care Tool is an interactive application designed to help organizations conduct Consequence Scanning to assess the potential impacts of their projects on people and society. This document provides detailed information about the system's architecture, code structure, and development practices.

## System Architecture

### Overview

The system consists of a web-based application that leverages various technologies and services, including Node.js for the backend, Express.js for server-side logic, Passport.js for authentication, MongoDB for data storage, and OpenAI's GPT for AI-driven assistance.

### Components

1. **Backend**:
   - **Node.js**: JavaScript runtime for the server-side code.
   - **Express.js**: Web framework for handling HTTP requests and routing.
   - **Passport.js**: Authentication middleware for handling user login via OAuth.
   - **Mongoose**: ODM for interacting with MongoDB.

2. **Frontend**:
   - **HTML/CSS/JavaScript**: For the user interface and interactions.
   - **jsonform.js**: For rendering forms that the user completes

3. **Database**:
   - **MongoDB**: NoSQL database for storing user data, token records, and project information.

4. **AI Integration**:
   - **OpenAI**: Used to assist with form completion and Consequence Scanning activities.

## Installation and Setup

### Prerequisites

- Node.js
- MongoDB
- OAuth credentials for Google and Django
- OpenAI API key

### Steps

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/your-repo/odi-care-tool.git
   cd odi-care-tool
   ```

2. **Install Dependencies**:
   ```bash
   npm install
   ```

3. **Configuration**:
   - Create a `config.env` file in the root directory based on the provided `config.env.example` file.
   - Fill in the required environment variables such as database connection strings, OAuth credentials, and OpenAI API key.

4. **Start the Server**:
   ```bash
   npm start
   ```

5. **Access the Application**:
   - Visit `http://localhost:3080` in your web browser.

## Code Structure

```
odi-care-tool/
│
├── controllers/             # Database collection controllers
├── middleware/              # Common expressJS middleware
├── models/                  # Database collection models
├── public/                  # Static files (HTML, CSS, JS, DATA (schemas, forms, examples, glossary), IMAGES)
├── routes/                  # Express routes
├── views/                   # EJS pages for rendering
│   ├── errors/              # Error pages
│   ├── pages/               # Main pages
│   └── partials/            # Headers and footers
├── config.env.example       # Example environment variables file
├── DEVELOPER.md             # Developer documentation
├── index.js                 # Main app file
├── package.json             # NPM dependencies and scripts
├── pages.json               # Questionaire structure
├── passport.js              # Authentication module
└── README.md                # User-facing documentation
```

## Development Practices

### Question pages

Quesiton pages are defined as a a combination of two things:
 1. A json schema (public/data/schemas/partials/)
 2. A form (public/data/forms/)

These two things when combined are parsed by the [https://github.com/jsonform/jsonform](jsonforms) library which renders the form, provides validation and a submit function.

The question pages are listed in pages.json and this controls the project progress and navigation elements, so all must match.

jsonform has been extended with two things:

 1. "next" attribute: This tells the submit function which page is next after submit
 2. "quickNav" attribute: This tells the submit function that the next form can be loaded without having to redirect the user and complete page reload.

### AI Integration

AI is integregrated into the form pages based upon their being a messageTemplate (public/data/messageTemplates) for the current page. If there is then this template will be read and autofilled with project data and the required json schema for the page. The AI is then asked to respond accord to the schema and users can select which reponses to add to their project. These are simply appended to the data and the form reloaded to show the new data.

#### AI for whole assessment

There is one special page that must be loaded from URL which asks the AI to do a complete assessment and not just a partial one. This works in a similar way to the method above except there are special handlers for this operation server side that add data directly into the database rather than requiring the use to submit the form.

### Version Control

- Use Git for version control.
- Follow branching strategies like GitFlow or feature branching.
- Write meaningful commit messages.

## API Documentation (Server)

### Endpoints

#### User Authentication

- **POST /auth/google**
- **POST /auth/django**
- **POST /logout**

#### Project Management

- **GET /projects**
- **POST /projects**
- **PUT /projects/:id**
- **DELETE /projects/:id**

#### AI Assistant

- **GET /assistant/:project_id/:message_id** - note the completeAssessment is a special route and doesn't return the AI response.

### Error Handling

- Ensure proper error handling and logging throughout the application.
- Use middleware to catch and handle errors uniformly.

## Contributing

1. Fork the repository.
2. Create a new branch (`git checkout -b feature-branch`).
3. Commit your changes (`git commit -m 'Add some feature'`).
4. Push to the branch (`git push origin feature-branch`).
5. Open a pull request.

## License

This project is licensed under the MIT License. See the [LICENSE.md](LICENSE.md) file for details.