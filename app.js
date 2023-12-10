const express = require("express");
const path = require("path");
const sqlite3 = require("sqlite3");
const { open } = require("sqlite");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const app = express();
app.use(express.json());

let db = null;
const dbPath = path.join(__dirname, "twitterClone.db");

const initializeDBAndServer = async () => {
  try {
    db = await open({ filename: dbPath, driver: sqlite3.Database });
    app.listen(3000, () => {
      console.log("Server running at port 3000");
    });
  } catch (e) {
    console.log(e.message);
    process.exit(1);
  }
};

initializeDBAndServer();

//API 1 Register
app.post("/register/", async (request, response) => {
  const { username, password, name, gender } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbResponse = await db.get(getUserQuery);

  if (dbResponse != undefined) {
    response.status(400);
    response.send("User already exists");
  } else if (password.length < 6) {
    response.status(400);
    response.send("Password is too short");
  } else {
    const hashedPassword = await bcrypt.hash(password, 10);
    const postUserQuery = `INSERT INTO user(username,password,name,gender)
        VALUES('${username}','${hashedPassword}','${name}','${gender}');`;
    const postUserDetails = await db.run(postUserQuery);
    const user_id = postUserDetails.lastID;
    response.status(200);
    response.send("User created successfully");
  }
});

//API 2 Login
app.post("/login/", async (request, response) => {
  const { username, password } = request.body;
  const getUserQuery = `SELECT * FROM user WHERE username = '${username}';`;
  const dbUser = await db.get(getUserQuery);

  if (dbUser === undefined) {
    response.status(400);
    response.send("Invalid user");
  } else {
    const isPasswordMatched = await bcrypt.compare(password, dbUser.password);
    if (isPasswordMatched === true) {
      const payload = { username: username };
      const jwtToken = await jwt.sign(payload, "SECRET_KEY");
      response.send({ jwtToken });
    } else {
      response.status(400);
      response.send("Invalid password");
    }
  }
});

//Authenticate JWT Token
const authenticateToken = async (request, response, next) => {
  let jwtToken;
  const authHeader = request.headers["authorization"];
  if (authHeader !== undefined) {
    jwtToken = authHeader.split(" ")[1];
  }
  if (jwtToken === undefined) {
    response.status(401);
    response.send("Invalid JWT Token");
  } else {
    await jwt.verify(jwtToken, "SECRET_KEY", async (error, payload) => {
      if (error) {
        response.status(401);
        response.send("Invalid JWT Token");
      } else {
        request.username = payload.username;
        next();
      }
    });
  }
};

//API 3 user feed
app.get("/user/tweets/feed/", authenticateToken, async (request, response) => {
  const { username } = request;

  const getTweetsFeedQuery = `SELECT tweet.tweet, tweet.date_time AS dateTime, user.username FROM follower LEFT JOIN 
  tweet ON follower.following_user_id = tweet.user_id 
  LEFT JOIN user ON user.user_id = follower.following_user_id
   WHERE follower.follower_user_id = 
   (SELECT user_id FROM user WHERE username = '${username}' ) ORDER BY date_time DESC LIMIT 4 OFFSET 0;`;
  const tweetsArray = await db.all(getTweetsFeedQuery);
  response.send(tweetsArray);
});

//API 4 following names list
app.get("/user/following/", authenticateToken, async (request, response) => {
  const { username } = request;

  const getFollowingListQuery = `SELECT name FROM follower LEFT JOIN user
   ON follower.following_user_id = user.user_id WHERE 
   follower_user_id = (SELECT user_id FROM user WHERE 
    username ='${username}' ) ;`;
  const followingArray = await db.all(getFollowingListQuery);
  response.send(followingArray);
});

//API 5 followers list
app.get("/user/followers/", authenticateToken, async (request, response) => {
  const { username } = request;

  const getFollowersListQuery = `SELECT name FROM follower LEFT JOIN user 
  ON follower.follower_user_id = user.user_id WHERE following_user_id =
   (SELECT user_id FROM user WHERE username = '${username}' ) ;`;
  const followersArray = await db.all(getFollowersListQuery);
  response.send(followersArray);
});

const verifyRequest = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const getFollowersQuery = `SELECT * FROM tweet WHERE tweet.tweet_id IN (SELECT tweet_id FROM tweet 
   LEFT JOIN follower ON tweet.user_id = follower.following_user_id
   LEFT JOIN user On follower.follower_user_id = user.user_id 
WHERE user.username = '${username}') AND tweet.tweet_id = ${tweetId};`;
  const validTweet = await db.get(getFollowersQuery);

  if (validTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//API 6 tweets by tweet id
app.get(
  "/tweets/:tweetId/",
  authenticateToken,
  verifyRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const getTweetIdQuery = `SELECT tweet, COUNT(DISTINCT like.like_id) AS likes, COUNT(DISTINCT reply.reply_id) AS replies, 
tweet.date_time AS dateTime FROM tweet LEFT JOIN like ON 
tweet.tweet_id = like.tweet_id LEFT JOIN reply ON 
tweet.tweet_id = reply.tweet_id WHERE tweet.tweet_id = ${tweetId}
 GROUP BY tweet.tweet_id `;
    const tweetObj = await db.get(getTweetIdQuery);
    response.send(tweetObj);
  }
);

//API 7 Likes of a requested tweet
app.get(
  "/tweets/:tweetId/likes/",
  authenticateToken,
  verifyRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const getLikesQuery = `SELECT user.username FROM like LEFT JOIN user ON like.user_id = user.user_id WHERE like.tweet_id = ${tweetId}`;
    const likeArray = await db.all(getLikesQuery);
    const likedUsernames = [];
    likeArray.map((eachItem) => likedUsernames.push(eachItem.username));
    response.send({ likes: likedUsernames });
  }
);

//API 8 Replies of requested tweet
app.get(
  "/tweets/:tweetId/replies/",
  authenticateToken,
  verifyRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const getRepliesQuery = `SELECT name,reply FROM reply LEFT JOIN user ON reply.user_id = user.user_id WHERE reply.tweet_id = ${tweetId}`;
    const repliesArray = await db.all(getRepliesQuery);
    const replies = [];
    repliesArray.map((eachItem) => replies.push(eachItem));
    response.send({ replies: replies });
  }
);

//API 9 All Tweets of user
app.get("/user/tweets/", authenticateToken, async (request, response) => {
  const { username } = request;
  const getTweetsQuery = `SELECT tweet, COUNT(DISTINCT like.like_id) AS likes, COUNT(DISTINCT reply.reply_id) AS replies, 
tweet.date_time AS dateTime FROM tweet LEFT JOIN like ON 
tweet.tweet_id = like.tweet_id LEFT JOIN reply ON 
tweet.tweet_id = reply.tweet_id WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = '${username}')
 GROUP BY tweet.tweet_id `;
  const tweetsArray = await db.all(getTweetsQuery);
  response.send(tweetsArray);
});

//Post a Tweet
app.post("/user/tweets/", authenticateToken, async (request, response) => {
  const tweetBody = request.body;
  const { username } = request;
  const getUserIdQuery = `SELECT user_id FROM user WHERE username = '${username}'`;
  const userIdObj = await db.get(getUserIdQuery);
  const userId = userIdObj.user_id;
  const { tweet } = tweetBody;
  const postTweetQuery = `INSERT INTO tweet(tweet,user_id,date_time)
    VALUES('${tweet}',${userId},DATE('now'))`;
  const dbResponse = await db.run(postTweetQuery);

  response.send("Created a Tweet");
});

const verifyDeleteRequest = async (request, response, next) => {
  const { tweetId } = request.params;
  const { username } = request;
  const getFollowersQuery = `SELECT * FROM tweet WHERE tweet.user_id = (SELECT user_id FROM user WHERE username = '${username}') AND tweet.tweet_id = ${tweetId};`;
  const validTweet = await db.get(getFollowersQuery);

  if (validTweet === undefined) {
    response.status(401);
    response.send("Invalid Request");
  } else {
    next();
  }
};

//Delete a Tweet
app.delete(
  "/tweets/:tweetId/",
  authenticateToken,
  verifyDeleteRequest,
  async (request, response) => {
    const { tweetId } = request.params;
    const deleteTweetQuery = `DELETE FROM tweet 
 WHERE tweet_id = ${tweetId};`;
    await db.run(deleteTweetQuery);
    response.send("Tweet Removed");
  }
);

module.exports = app;
