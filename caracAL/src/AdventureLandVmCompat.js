"use strict";

const vm = require("vm");

const CROSS_REALM_CLONE_SOURCE = String.raw`
clone = function(obj, args) {
  if (!args) args = {};
  if (!args.seen) args.seen = [];
  if (obj === null || obj === undefined) return obj;
  if (args.simple_functions && typeof obj === "function")
    return "[clone]:" + obj.toString().substring(0, 40);
  if (typeof obj !== "object") return obj;

  var tag = Object.prototype.toString.call(obj);
  if (tag === "[object Date]") {
    var date_copy = new Date();
    date_copy.setTime(obj.getTime());
    return date_copy;
  }

  if (Array.isArray(obj)) {
    args.seen.push(obj);
    var array_copy = [];
    for (var i = 0; i < obj.length; i++) {
      if (args.seen.indexOf(obj[i]) !== -1) {
        array_copy[i] = "circular_attribute[clone]";
        continue;
      }
      array_copy[i] = clone(obj[i], args);
    }
    return array_copy;
  }

  args.seen.push(obj);
  var object_copy = {};
  for (var attr in obj) {
    if (!Object.prototype.hasOwnProperty.call(obj, attr)) continue;
    if (args.seen.indexOf(obj[attr]) !== -1) {
      object_copy[attr] = "circular_attribute[clone]";
      continue;
    }
    object_copy[attr] = clone(obj[attr], args);
  }
  return object_copy;
};
`;

function installCrossRealmClone(context) {
  vm.runInContext(CROSS_REALM_CLONE_SOURCE, context);
}

function setAdventureLandAuthCookie(context, session) {
  if (
    !context ||
    !context.document ||
    typeof session !== "string" ||
    !session
  ) {
    return false;
  }

  context.document.cookie = `auth=${session}; Path=/; Secure; SameSite=Lax`;
  return context.document.cookie
    .split(";")
    .map((value) => value.trim())
    .some((value) => value === `auth=${session}`);
}

module.exports = {
  CROSS_REALM_CLONE_SOURCE,
  installCrossRealmClone,
  setAdventureLandAuthCookie,
};
