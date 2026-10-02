"use strict";

const { JSDOM } = require("jsdom");

function createIsolatedBrowserContext(html, url = "https://adventure.land/") {
  const dom = new JSDOM(html, {
    url,
    runScripts: "outside-only",
  });

  return {
    dom,
    window: dom.window,
    context: dom.getInternalVMContext(),
  };
}

module.exports = {
  createIsolatedBrowserContext,
};
