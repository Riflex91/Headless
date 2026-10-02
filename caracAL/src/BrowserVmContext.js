"use strict";

const { JSDOM } = require("jsdom");

function createIsolatedBrowserWindow(html, url = "https://adventure.land/") {
  return new JSDOM(html, {
    url,
    runScripts: "outside-only",
  }).window;
}

module.exports = {
  createIsolatedBrowserWindow,
};
