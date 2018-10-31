// Express requirements
import path from "path";
import fs from "fs";

// React requirements
import React from "react";
import { renderToString } from "react-dom/server";
import { HelmetProvider } from "react-helmet-async";
import { Provider } from "react-redux";
import { StaticRouter } from "react-router";
import fetch from "node-fetch";
import { Frontload, frontloadServerRender } from "react-frontload";
import Loadable from "react-loadable";
import { ApolloProvider, getDataFromTree } from "react-apollo";
import { ApolloClient } from "apollo-client";
import { createHttpLink } from "apollo-link-http";
import { InMemoryCache } from "apollo-cache-inmemory";

// Our store, entrypoint, and manifest
import createStore from "../src/store";
import App from "../src/app/app";
import manifest from "../build/asset-manifest.json";

// Some optional Redux functions related to user authentication
import { setCurrentUser, logoutUser } from "../src/modules/auth";

const IS_PROD = process.env.NODE_ENV === "production";
const FORCE_DEV = process.env.FORCE_DEV;
const FIVE_MINUTES = 300;
const ONE_HOUR = 3600;

const GRAPHQL_ENDPOINT = "http://www.betengineering.it/graphql";

// if (!IS_PROD || FORCE_DEV) debug("Querying API GRAPHQL_ENDPOINT");

// LOADER
export default (req, res) => {
  const client = new ApolloClient({
    ssrMode: true,
    // Remember that this is the interface the SSR server will use to connect to the
    // API server, so we need to ensure it isn't firewalled, etc
    link: createHttpLink({
      uri: GRAPHQL_ENDPOINT,
      fetch,
      //credentials: "same-origin",
      headers: {
        cookie: req.header("Cookie")
      }
    }),
    cache: new InMemoryCache()
  });
  /*
    A simple helper function to prepare the HTML markup. This loads:
      - Page title
      - SEO meta tags
      - Preloaded state (for Redux) depending on the current route
      - Code-split script tags depending on the current route
  */
  const injectHTML = (data, { html, title, meta, body, scripts, state }) => {
    data = data.replace("<html>", `<html ${html}>`);
    data = data.replace(/<title>.*?<\/title>/g, title);
    data = data.replace("</head>", `${meta}</head>`);
    data = data.replace(
      '<div id="root"></div>',
      `<div id="root">${body}</div><script>window.__PRELOADED_STATE__ = ${state}</script>`
    );
    data = data.replace("</body>", scripts.join("") + "</body>");

    return data;
  };

  // Load in our HTML file from our build
  fs.readFile(
    path.resolve(__dirname, "../build/index.html"),
    "utf8",
    (err, htmlData) => {
      // If there's an error... serve up something nasty
      if (err) {
        console.error("Read error", err);

        return res.status(404).end();
      }

      // Create a store (with a memory history) from our current url
      const { store } = createStore(req.url);

      // If the user has a cookie (i.e. they're signed in) - set them as the current user
      // Otherwise, we want to set the current state to be logged out, just in case this isn't the default
      if ("mywebsite" in req.cookies) {
        store.dispatch(setCurrentUser(req.cookies.mywebsite));
      } else {
        store.dispatch(logoutUser());
      }

      const helmetContext = {};
      const context = {};
      const modules = [];

      /*
        Here's the core funtionality of this file. We do the following in specific order (inside-out):
          1. Load the <App /> component
          2. Inside of the Frontload HOC
          3. Inside of a Redux <StaticRouter /> (since we're on the server), given a location and context to write to
          4. Inside of the store provider
          5. Inside of the React Loadable HOC to make sure we have the right scripts depending on page
          6. Render all of this sexiness
          7. Make sure that when rendering Frontload knows to get all the appropriate preloaded requests

        In English, we basically need to know what page we're dealing with, and then load all the appropriate scripts and
        data for that page. We take all that information and compute the appropriate state to send to the user. This is
        then loaded into the correct components and sent as a Promise to be handled below.
      */

      /*
      getDataFromTree(App).then(() => {
        const content = ReactDOM.renderToString(App);
        const initialState = client.extract();

        const html = <Html content={content} state={initialState} />;

        res.status(200);
        res.send(`<!doctype html>\n${ReactDOM.renderToStaticMarkup(html)}`);
        res.end();
      */

      const frontend = (
        <Loadable.Capture report={m => modules.push(m)}>
          <ApolloProvider client={client}>
            <HelmetProvider context={helmetContext}>
              <Provider store={store}>
                <StaticRouter location={req.url} context={context}>
                  <Frontload isServer={true}>
                    <App />
                  </Frontload>
                </StaticRouter>
              </Provider>
            </HelmetProvider>
          </ApolloProvider>
        </Loadable.Capture>
      );

      (async () => await getDataFromTree(frontend))();

      // const state = store.getState();
      // const data = client.extract();

      //debug("write header");
      // Use now's CDN to cache the rendered pages in CloudFlare for half an hour
      // Ref https://zeit.co/docs/features/cdn
      if (!req.user) {
        res.setHeader(
          "Cache-Control",
          `max-age=${FIVE_MINUTES}, s-maxage=${ONE_HOUR}, stale-while-revalidate=${FIVE_MINUTES}, must-revalidate`
        );
      } else {
        res.setHeader("Cache-Control", "s-maxage=0");
      }
      /*
      res.write(
        getHeader({
          metaTags:
            helmet.title.toString() +
            helmet.meta.toString() +
            helmet.link.toString()
        })
      );
*/
      frontloadServerRender(() => renderToString(frontend)).then(
        routeMarkup => {
          if (context.url) {
            // If context has a url property, then we need to handle a redirection in Redux Router
            res.writeHead(302, {
              Location: context.url
            });

            res.end();
          } else {
            // Otherwise, we carry on...

            // Let's give ourself a function to load all our page-specific JS assets for code splitting
            const extractAssets = (assets, chunks) =>
              Object.keys(assets)
                .filter(asset => chunks.indexOf(asset.replace(".js", "")) > -1)
                .map(k => assets[k]);

            // Let's format those assets into pretty <script> tags
            const extraChunks = extractAssets(manifest, modules).map(
              c =>
                `<script type="text/javascript" src="/${c.replace(
                  /^\//,
                  ""
                )}"></script>`
            );

            // We need to tell Helmet to compute the right meta tags, title, and such
            const { helmet } = helmetContext;

            // NOTE: Disable if you desire
            // Let's output the title, just to see SSR is working as intended
            console.log("THE TITLE", helmet.title.toString());

            // Pass all this nonsense into our HTML formatting function above
            const html = injectHTML(htmlData, {
              html: helmet.htmlAttributes.toString(),
              title: helmet.title.toString(),
              meta: helmet.meta.toString(),
              body: routeMarkup,
              scripts: extraChunks,
              state: JSON.stringify(store.getState()).replace(/</g, "\\u003c")
            });

            // We have all the final HTML, let's send it to the user already!
            res.send(html);
          }
        }
      );
    }
  );
};
