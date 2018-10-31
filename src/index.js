import React from "react";
import { render, hydrate } from "react-dom";
import { Provider } from "react-redux";
import Loadable from "react-loadable";
import { Frontload } from "react-frontload";
import { HelmetProvider } from "react-helmet-async";
import { ConnectedRouter } from "connected-react-router";
import createStore from "./store";

import { ApolloProvider } from "react-apollo";
import { ApolloClient } from "apollo-client";
import { InMemoryCache } from "apollo-cache-inmemory";
import { WebSocketLink } from "apollo-link-ws";
import createBrowserHistory from "history/createBrowserHistory";

import App from "./app/app";
import "./index.css";

// Create a store and get back itself and its history object
const { store, history } = createStore();

//import { initStore } from "./store";

//const store = initStore(window.__SERVER_STATE__ || {});

const GRAPHQL_ENDPOINT = "wss://www.betengineering.it/subscriptions";

const wsLink = new WebSocketLink({
  uri: GRAPHQL_ENDPOINT,
  options: {
    reconnect: true
  }
});

const cache = new InMemoryCache();

const createClient = () => {
  return new ApolloClient({
    link: wsLink,
    cache
    // ssrForceFetchDelay: 100,
    // queryDeduplication: true
  });
};

const client = createClient();
//should come from localstate
const storedData = null;

// Running locally, we should run on a <ConnectedRouter /> rather than on a <StaticRouter /> like on the server
// Let's also let React Frontload explicitly know we're not rendering on the server here
const Application = (
  <Provider store={store}>
    <ConnectedRouter history={history}>
      <Frontload noServerRender={true}>
        <HelmetProvider>
          <ApolloProvider client={client}>
            <App />
          </ApolloProvider>
        </HelmetProvider>
      </Frontload>
    </ConnectedRouter>
  </Provider>
);

const root = document.querySelector("#root");

if (root.hasChildNodes() === true) {
  // If it's an SSR, we use hydrate to get fast page loads by just
  // attaching event listeners after the initial render
  Loadable.preloadReady().then(() => {
    hydrate(Application, root);
  });
} else {
  // If we're not running on the server, just render like normal
  render(Application, root);
}
