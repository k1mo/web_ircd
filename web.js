var WEBPORT = 10001;
var IRCPORT = 6667;
var MESSAGE_BACKLOG = 200;
var SESSION_TIMEOUT = 60 * 1000;

var fu = require("./fu");
var sys = require("sys");
ircd = require("./ircd");
var repl = require("repl");
var url = require("url");

// Do this so the server doesn't crash during the demo.
process.addListener("uncaughtException", function (e) {
  sys.puts("uncaught exception: " + e);
  if (e.stack) { sys.puts(e.stack); }
});

ircd.start(IRCPORT);

var messages = [];
var callbacks = [];

function broadcast (nick, type, text) {
  var m = { nick: nick
          , type: type // "msg", "join", "part"
          , text: text
          , timestamp: (new Date()).getTime()
          };
  messages.push(m);

  while (callbacks.length > 0) {
    callbacks.shift().callback([m]);
  }

  while (messages.length > MESSAGE_BACKLOG) {
    messages.shift();
  }
}

function query (since, callback) {
  /*
  if (messages.length == 0) {
    callback([]);
    return;
  }
  */

  var matching = [];
  for (var i = 0; i < messages.length; i++) {
    var message = messages[i];
    if (message.timestamp > since) matching.push(message)
  }

  if (matching.length != 0) {
    callback(matching);
  } else {
    callbacks.push({ timestamp: new Date(), callback: callback });
  }
};

var webChannel = ircd.lookupChannel("#web");

webChannel.addListener("privmsg", function (nick, msg) {
  broadcast(nick, "msg", msg);
});

webChannel.addListener("join", function (nick) {
  broadcast(nick, "join");
});

webChannel.addListener("part", function (nick) {
  broadcast(nick, "part");
});

var sessions = {};

function createSession () {
  // register a new session. should probably do some DoS protection here
  // by examining req.connection.remoteAddress... but not for the demo.
  var session = {
    id: Math.floor(Math.random()*99999999999).toString(),

    poke: function () {
      session.timestamp = new Date();
    },

    destroy: function () {
      sessions[session.id] = undefined;
    }
  };
  session.poke();
  sessions[session.id] = session;
  return session;
}

setInterval(function () {
  // kill off old sessions
  var now = new Date();
  for (var id in sessions) {
    if (!sessions.hasOwnProperty(id)) continue;
    var session = sessions[id];
    if (!session) continue;
    if (now - session.timestamp > SESSION_TIMEOUT) {
      session.destroy();
    }
  }

  // clear old callbacks
  // they can hang around for at most 30 seconds.
  var now = new Date();
  while (callbacks.length > 0 && now - callbacks[0].timestamp > 30*1000) {
    callbacks.shift().callback([]);
  }
}, 5000);

fu.listen(WEBPORT);

fu.get("/", fu.staticHandler("index.html"));
fu.get("/style.css", fu.staticHandler("style.css"));
fu.get("/client.js", fu.staticHandler("client.js"));
fu.get("/jquery-1.2.6.min.js", fu.staticHandler("jquery-1.2.6.min.js"));
fu.get("/poll", function (req, res) {
  var params = url.parse(req.url, true).query;

  if (!params.since) {
    res.simpleJSON(400, { error: "Must supply since parameter" });
    return;
  }

  var id = params.id;
  var session = (id && sessions[id]) ? sessions[id] : createSession();

  var since = parseInt(params.since, 10);

  query(since, function (msgs) {
    if (session) {
      session.poke();
      res.simpleJSON(200, { id: session.id, messages: msgs });
    } else {
      res.simpleJSON(400, { error: "unknown error. timeout?" });
    }
  });
});

sys.puts("irc.js on port " + IRCPORT);
repl.start("ircd> ");
