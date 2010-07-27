var serverName = "irc.nodejs.org";
var topic = "node.js";

net = require("net");
sys = require("sys");
var puts = sys.puts;
inspect = sys.inspect;

debugLevel = 0;

function debug (m) {
  if (debugLevel > 0) puts(m);
}

function debugObj (m) {
  if (debugLevel > 0) puts(inspect(m));
}

function simpleString (s) {
  if (s) return s.replace(/[^\w]/, "_", "g");
}

exports.channels = {};
var channels = exports.channels;
exports.users = {};
var users = exports.users;

// Channel

function Channel (name) {
  this.name = name;
  this.topic = null;
  this.users = [];
}
sys.inherits(Channel, process.EventEmitter);

// If a channel object for this channel doesn't exist yet, create it.
function lookupChannel (name) {
  if (channels[name]) return channels[name];
  channels[name] = new Channel(name);
  return channels[name];
}
exports.lookupChannel = lookupChannel;

// broadcast to everyone except the person who sent the message
Channel.prototype.broadcastEveryoneElse = function (msg, from) {
  for (var j = 0; j < this.users.length; j++) {
    var user = this.users[j];
    if (user == from) continue;
    user.sendMessage(msg, from);
  }
};

Channel.prototype.broadcast = function (msg, from) {
  this.broadcastEveryoneElse(msg, from);
  from.sendMessage(msg, from);
};

Channel.prototype.quit = function (user, msg) {
  for (var i = 0; i < this.users.length; i++) {
    if (this.users[i] == user) {
      this.users.splice(i, 1);
    }
  }
  this.broadcast("QUIT :" + (msg || "quit"), user);
  this.emit("part", user.nick);
};

Channel.prototype.privmsg = function (msg, user) {
  this.broadcastEveryoneElse("PRIVMSG " + this.name + " :" + msg, user);
  this.emit("privmsg", user.nick, msg);
};

Channel.prototype.sendTopic = function (user) {
  // RPL_TOPIC
  user.sendMessage("332 " + user.nick + " " + this.name + " :" + topic);
};

Channel.prototype.sendNames = function (user) {
  var startOfNAMREPLY = "353 " + user.nick + " @ " + this.name + " :";

  // this is to ensure the packet is not too long
  var packet = new String(startOfNAMREPLY);
  for (var i = 0; i < this.users.length; i++) {
    packet += (this.users[i].nick + " ");
    if (packet.length > 500) {
      user.sendMessage(packet);
      packet = new String(startOfNAMREPLY);
    }
  }
  user.sendMessage(packet);

  // RPL_NAMREPLY
  user.sendMessage("366 " + user.nick + " " + this.name + " :End of /NAMES list");
};

Channel.prototype.sendWho = function (user) {
  for (var i = 0; i < this.users.length; i++) {
    var u = this.users[i];
    user.sendMessage([ "352"
                     , user.nick
                     , this.name
                     , u.names.user
                     , u.socket.remoteAddress
                     , serverName
                     , u.nick
                     , "@"
                     , ":0"
                     , u.names.real
                     ].join(" "));
  }

  // ENDOFWHO
  user.sendMessage("315 " + user.nick + " " + this.name + " :End of /WHO list");
};

Channel.prototype.join = function (user) {

  debug("JOIN. user list: " + this.inspectUsers());

  // TODO check to make sure user isn't already in channel.
  for (var i = 0; i < this.users.length; i++) {
    if (this.users[i] == user) return false;
  }

  // Add user to array
  this.users.push(user);

  // Send everyone a message that this user joined.
  this.broadcast("JOIN :" + this.name, user);


  this.sendNames(user);

  this.sendTopic(user);

  debug("AFTER JOIN. user list: " + this.inspectUsers());

  this.emit("join", user.nick);

  return true;
};

Channel.prototype.inspectUsers = function () {
  return inspect(this.users.map(function (user) { return user.nick; }));
}

Channel.prototype.part = function (user) {
  var packet = "PART " + this.name + " :";

  debug("PART. user list: " + this.inspectUsers());

  for (var i = 0; i < this.users.length; i++) {
    if (this.users[i] == user) {
      this.users.splice(i, 1);
      user.sendMessage(packet, user);
      break;
    }
  }

  debug("After PART. user list: " + this.inspectUsers());

  this.broadcast(packet, user);
  this.emit("part", user.nick);
};

function normalizeChannelName (channelName) {
  if (channelName) {
    return channelName.replace(/[^\w]/, "_", "g")
                      .toLowerCase()
                      .replace(/^_+/, "#");
  }
}



// User

function User (socket) {
  this.socket = socket;
  this.channels = [];
  this.registered = false;
  this.nick = null;
  this.names = {};
  this.names = { user: "x"
               , host: "x"
               , server: "x"
               , real: "x"
               };
}

User.prototype.sendMessage = function (msg, from) {
  if (this.socket.readyState !== "open" && this.socket.readyState !== "writeOnly") {
    return false;
  }

  var prefix;
  if (from) {
    prefix = from.prefix();
  } else {
    prefix = serverName;
  }

  // TODO check if the socket is writable!
  var packet = ":" + prefix + " " + msg + "\r\n";

  if (this.nick) {
    debug("write to " + this.nick + ": " + inspect(packet));
  } else {
    debug("write " + ": " + inspect(packet));
  }

  this.socket.write(packet, "utf8");
};

User.prototype.prefix = function () {
  // <prefix> ::=
  //     <servername> | <nick> [ '!' <user> ] [ '@' <host> ]
  return this.nick + "!" + this.names.user + "@" + this.socket.remoteAddress;
};

User.prototype.join = function (channelName) {
  var channelName = normalizeChannelName(channelName);

  for (var i = 0; i < this.channels.length; i++) {
    // check if the user is already in this channel.
    if (channelName == this.channels[i].name) return;
  }

  var channel = lookupChannel(channelName);

  if(channel.join(this)) {
    this.channels.push(channel);
  }
}


function maybeRegister (user) {
  if (user.nick && user.names && !user.registered) {
    user.sendMessage("001 " + user.nick + " :Welcome to " + serverName);
    user.registered = true;
  }
}

// sends a message to all users in all channels that the user belongs to
User.prototype.broadcast = function (msg) {
  for (var i = 0; i < this.channels.length; i++) {
    this.channels[i].broadcast(msg, this);
  }
};

User.prototype.changeNick = function (newNick) {
  debug("Got NICK: " + inspect(newNick));

  if (newNick.length > 30 || /^[a-zA-Z]([a-zA-Z0-9_\-\[\]\\`^{}]+)$/.exec(newNick) == null) {
    // ERR_ERRONEUSNICKNAME
    this.sendMessage("432 * " + newNick + " :Erroneus nickname");
    return;
  }

  if (users[newNick]) {
    if (users[newNick] == this) return;
    // ERR_NICKNAMEINUSE
    this.sendMessage("433 * " + newNick + " :Nick in use");
    return;
  }

  if (this.nick) {
    var packet = "NICK :" + newNick;
    this.sendMessage(packet, this);
    this.broadcast(packet, this);

    users[this.nick] = undefined;
    users[newNick] = this;
    this.nick = newNick;

  } else {
    users[newNick] = this;
    this.nick = newNick;
  }

};

User.prototype.privmsg = function (target, msg) {
  if (target.charAt(0) == "#") {
    var channelName = normalizeChannelName(target);
    for (var i = 0; i < this.channels.length; i++) {
      // make sure the user is in that channel.
      if (channelName == this.channels[i].name) {
        this.channels[i].privmsg(msg, this);
        return;
      }
    }
  } else if (users[target]) {
    var user = users[target];
    user.sendMessage("PRIVMSG " + user.nick + " :" + msg, this);
  }
};

User.prototype.part = function (channelName) {
  channelName = normalizeChannelName(channelName);

  for (var i = 0; i < this.channels.length; i++) {
    if (this.channels[i].name == channelName) {
      this.channels.splice(i, 1);
      break;
    }
  }

  if (channels[channelName]) {
    channels[channelName].part(this);
  }
};

User.prototype.quit = function (msg) {
  users[this.nick] = undefined;
  while (this.channels.length > 0) {
    this.channels.pop().quit(this, msg);
  }
  this.socket.destroy();
};

User.prototype.parse = function (message) {
  var match = /^(\w+)\s+(.*)$/.exec(message);
  if (!match) {
    debug("cannot parse: " + inspect(message));
    return;
  }
  var command = match[1].toUpperCase();
  var rest = match[2];

  switch (command) {
    case "NICK":
      var newNick = rest;

      this.changeNick(newNick);
      maybeRegister(this);
      break;

    case "USER":
      match = /^([^\s]+)\s+([^\s]+)\s+([^\s]+)(\s+:(.*))?$/.exec(rest);
      if (!match) return;
      this.names = { user: simpleString(match[1])
                   , host: simpleString(match[2])
                   , server: simpleString(match[3])
                   , real: simpleString(match[5])
                   };
      debug("Got USER: ");
      debugObj(this.names);
      maybeRegister(this);
      break;

    case "JOIN":
      var args = rest.split(/\s/);
      var chans = args[0].split(",");
      for (var i = 0; i < chans.length; i++) {
        this.join(chans[i]);
      }
      break;

    case "PART":
      var args = rest.split(/\s/);
      var chans = args[0].split(",");
      for (var i = 0; i < chans.length; i++) {
        this.part(chans[i]);
      }
      break;

    case "NAMES":
      var args = rest.split(/\s/);
      var channelNames = args[0].split(",");
      for (var i = 0; i < channelNames.length; i++) {
        var channelName = normalizeChannelName(channelNames[i]);
        if (channels[channelName]) {
          channels[channelName].sendNames(this);
        }
      }
      break;
      
    case "WHO":
      var args = rest.split(/\s/);
      var channelName = normalizeChannelName(args[0]);
      if (channels[channelName]) {
        channels[channelName].sendWho(this);
      }
      break;

    case "PRIVMSG":
      var matches = /^([^\s]+)\s+:(.*)$/.exec(rest);
      if (!match) return; // ignore
      var target = matches[1];
      var message = matches[2];
      this.privmsg(target, message);
      break;

    case "PING":
      var servers = rest.split(/\s/);
      this.sendMessage("PONG " + serverName);
      break;

    case "QUIT":
      var matches = /^:(.*)$/.exec(rest)
      this.quit(matches ? matches[1] : "");
      break;

    case "MODE":
    case "PONG":
      // ignore
      break;

    default:
      debug("Unhandled message: " + inspect(message));
      this.sendMessage("421 " + command + " :Unknown command");
      break;
  }
};



var server = net.createServer(function (socket) {
  socket.setTimeout(10 * 60 * 1000); // 10 minute idle timeout
  socket.setEncoding("utf8");
  debug("Connection " + socket.remoteAddress);

  var user = new User(socket);
  var buffer = "";

  // note all these try-catches are just to avoid the server crashing during
  // the demo. in real-life you would want to test away these problems.
  // (We're adding on having a high-level "catch all uncaught exceptions"
  // feature soon, which would also solve this proble.)

  socket.addListener("data", function (packet) {
    buffer += packet;
    var i;
    while (i = buffer.indexOf("\r\n")) {
      if (i < 0) break;
      var message = buffer.slice(0, i);
      if (message.length > 512) {
        user.quit("flooding");
      } else {
        buffer = buffer.slice(i+2);
        user.parse(message);
      }
    }
  });

  socket.addListener("end", function (packet) {
    user.quit("connection reset by peer");
  });

  socket.addListener("timeout", function (packet) {
    user.quit("idle timeout");
  });
});

exports.start = function (port, host) {
  server.listen(port, host);
};
