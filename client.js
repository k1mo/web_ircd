var CONFIG = { debug: false
             , id: null
             , lastMessageTime: 0
             };

var nicks = [];

function updateUsersLink ( ) {
  var t = nicks.length.toString() + " user";
  if (nicks.length != 1) t += "s";
  //$("#usersLink").text(t);
}

function userJoin(nick, timestamp) {
  addMessage(nick, "joined", timestamp, "join");
  for (var i = 0; i < nicks.length; i++)
    if (nicks[i] == nick) return;
  nicks.push(nick);
  updateUsersLink();
}

function userPart(nick, timestamp) {
  addMessage(nick, "left", timestamp, "part");
  for (var i = 0; i < nicks.length; i++) {
    if (nicks[i] == nick) {
      nicks.splice(i,1)
      break;
    }
  }
  updateUsersLink();
}

// utility functions

util = {
  urlRE: /https?:\/\/([-\w\.]+)+(:\d+)?(\/([^\s]*(\?\S+)?)?)?/g, 

  //  html sanitizer 
  toStaticHTML: function(inputHtml) {
    return inputHtml.replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
  }, 

  zeroPad: function (digits, n) {
    n = n.toString();
    while (n.length < digits) 
      n = '0' + n;
    return n;
  },

  timeString: function (date) {
    var minutes = date.getMinutes().toString();
    var hours = date.getHours().toString();
    return this.zeroPad(2, hours) + ":" + this.zeroPad(2, minutes);
  },

  isBlank: function(text) {
    var blank = /^\s*$/;
    return (text.match(blank) !== null);
  }
};

function scrollDown () {
  window.scrollBy(0, 100000000000000000);
}

function addMessage (from, text, time, _class) {
  if (text === null)
    return;

  if (time == null) {
    // if the time is null or undefined, use the current time.
    time = new Date();
  } else if ((time instanceof Date) === false) {
    // if it's a timestamp, interpret it
    time = new Date(time);
  }

  var messageElement = $(document.createElement("table"));

  messageElement.addClass("message");
  if (_class)
    messageElement.addClass(_class);

  // sanitize
  text = util.toStaticHTML(text);

  // See if it matches our nick?
  var nick_re = new RegExp(CONFIG.nick);
  if (nick_re.exec(text))
    messageElement.addClass("personal");

  // replace URLs with links
  text = text.replace(util.urlRE, '<a target="_blank" href="$&">$&</a>');

  var content = '<tr>'
              + '  <td class="date">' + util.timeString(time) + '</td>'
              + '  <td class="nick">' + util.toStaticHTML(from) + '</td>'
              + '  <td class="msg-text">' + text  + '</td>'
              + '</tr>'
              ;
  messageElement.html(content);

  $("#log").append(messageElement);
  scrollDown();
}

var transmission_errors = 0;

function longPoll (data) {
  if (transmission_errors > 2) {
    return;
  }

  if (data && data.messages) {

    if (data.id) {
      CONFIG.id = data.id;
    } else {
      return;
    }

    for (var i = 0; i < data.messages.length; i++) {
      var message = data.messages[i];

      if (message.timestamp > CONFIG.lastMessageTime)
        CONFIG.lastMessageTime = message.timestamp;

      switch (message.type) {
        case "msg":
          addMessage(message.nick, message.text, message.timestamp);
          break;

        case "join":
          userJoin(message.nick, message.timestamp);
          break;

        case "part":
          userPart(message.nick, message.timestamp);
          break;
      }
    }

    showChat();
  }

  $.ajax({ cache: false
         , type: "GET"
         , url: "/poll"
         , dataType: "json"
         , data: { since: CONFIG.lastMessageTime, id: CONFIG.id }
         , error: function () {
             addMessage("", "long poll error. trying again...", new Date(), "error");
             transmission_errors += 1;
             setTimeout(longPoll, 10*1000);
           }
         , success: function (data) {
             transmission_errors = 0;
             longPoll(data);
           }
         });
}

function showLoad () {
  $("#loading").show();
}

function showChat () {
  $("#loading").hide();
  scrollDown();
}

$(document).ready(function() {

  showLoad();

  if (CONFIG.debug) {
    $("#loading").hide();
    scrollDown();
    return;
  }

  // remove fixtures
  $("#log table").remove();

  longPoll();
});
