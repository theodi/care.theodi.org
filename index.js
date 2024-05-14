const path = require('path');
const fs = require('fs');

// Load environment variables securely
require("dotenv").config({ path: "./config.env" });

// MongoDB setup
const mongoose = require('mongoose');

// Read MongoDB URI and database name from environment variables
const mongoURI = process.env.MONGO_URI;
const mongoDB = process.env.MONGO_DB;

// Connect to MongoDB
mongoose.connect(mongoURI, { dbName: mongoDB });

const db = mongoose.connection;

// Check MongoDB connection
db.on('error', console.error.bind(console, 'MongoDB connection error:'));
db.once('open', function() {
  console.log("Connected to MongoDB database");
});

// Set up App

const express = require('express');
const session = require('express-session');
const passport = require('./passport'); // Require the passport module
const authRoutes = require('./routes/auth'); // Require the authentication routes module
const projectRoutes = require('./routes/project'); // Require the project routes module
const app = express();
const port = process.env.PORT || 3080;
app.set('view engine', 'ejs');

// Middleware for logging
const logger = require('morgan');
app.use(logger('dev'));

// Middleware for parsing incoming requests
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Other middleware and setup code...

// Session configuration
app.use(session({
  resave: false,
  saveUninitialized: true,
  secret: process.env.SESSION_SECRET,
}));

// Middleware for user object

// Initialize Passport.js
app.use(passport.initialize());
app.use(passport.session());

app.use(function(req, res, next) {
  res.locals.user = req.session.passport ? req.session.passport.user : req.session.user;
  next();
});

// Logout route
app.post('/logout', function(req, res, next){
  req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
});

// Middleware to ensure authentication
function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated())
    return next();
  else
    unauthorised(res);
}

function unauthorised(res) {
  const page = {
    title: "Error"
  };
  res.locals.page = page;
  const error = new Error("Unauthorized access");
  error.status = 401;
  throw error;
}

// Routes

app.use(express.static(__dirname + '/public')); // Public directory

// Use authentication routes
app.use('/auth', authRoutes);

// Use authentication routes
app.use('/project', projectRoutes);

app.get('/', function(req, res) {
  const page = {
    title: "Consequence and Risk Evaluation (CARE)",
    link: "/"
  };
  res.locals.page = page;
  res.render('pages/home');
});

app.get('/new', ensureAuthenticated, function(req, res) {
  const page = {
    title: "Project details",
    link: "projectDetails"
  };
  res.locals.page = page;
  res.render('pages/scan', { project: '' });
});

app.get('/examples', ensureAuthenticated, function(req, res) {
  const page = {
    title: "Example case studies",
    link: "/new"
  };
  res.locals.page = page;
  res.render('pages/examples');
});

app.post("/openai-completion", async (req, res) => {
  // Check if the authorization header with bearer token exists
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Bearer token missing' });
  }

  // Extract the token from the authorization header
  const token = authHeader.split(' ')[1];
  try {
    // Verify the token's validity
    const isValidToken = await verifyToken(token);
    if (!isValidToken) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // Proceed to chat with OpenAI
    const response = await openai.chat.completions.create({
      ...req.body,
    });
    res.status(200).send(response.data || response);
  } catch (error) {
    console.error("Error in /openai-completion route:", error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

app.get('/profile', ensureAuthenticated, function(req, res) {
  const page = {
    title: "Profile page",
    link: "/profile"
  };
  res.locals.page = page;
  res.render('pages/profile');
});

const projectController = require('./controllers/project');

app.get('/projects', ensureAuthenticated, async (req, res, next) => {
    try {
        // Check if the request accepts JSON
        const acceptHeader = req.get('Accept');

        if (acceptHeader === 'application/json') {
            // Fetch user projects and send JSON response
            const userId = req.session.passport.user.id;
            const userProjects = await projectController.getUserProjects(userId);
            res.json(userProjects);
        } else {
            const page = {
              title: "Evaluations",
              link: "/projects"
            };
            res.locals.page = page;
            res.render('pages/projects');
        }
    } catch (error) {
      next(error);
    }
});

app.get('/schemas/:schema(*)', ensureAuthenticated, async (req, res, next) => {
  try {
      const schemaPath = req.params.schema;
      const fullPath = path.join(__dirname, 'schemas', schemaPath);
      if (fs.existsSync(fullPath)) {
          const schema = require(fullPath);
          return res.json(schema);
      } else {
          return res.status(404).json({ error: 'Schema not found' });
      }
  } catch (error) {
      next(error);
  }
});

// Error handling
app.get('/error', (req, res) => res.send("error logging in"));

app.get('*', function(req, res, next){
  const page = {
    title: "404 Not Found"
  };
  res.locals.page = page;
  const error = new Error("Not Found");
  error.status = 404;
  next(error);
});

// Error handling middleware
app.use((err, req, res, next) => {
  // Default status code for unhandled errors
  let statusCode = 500;
  let errorMessage = "Internal Server Error";
  // Check if the error has a specific status code and message
  if (err.status) {
      statusCode = err.status;
      errorMessage = err.message;
  }

  // Log the error stack trace
  console.error(err.stack);

  // Content negotiation based on request Accept header
  const acceptHeader = req.get('Accept');

  if (acceptHeader === 'application/json') {
      // Respond with JSON
      res.status(statusCode).json({ message: errorMessage });
  } else {
      // Respond with HTML (rendering an error page)
      res.status(statusCode).render('errors/error', { statusCode, errorMessage });
  }
});

// Start server
app.listen(port , () => console.log('App listening on port ' + port));