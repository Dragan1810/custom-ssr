import React from "react";
import Page from "../../components/page";
import { css } from "emotion";

export default () => (
  <Page id="about" title="About" description="This is about really cool stuff.">
    <div
      className={css`
        background-color: hotpink;
        min-height: 300px;
      `}
    >
      <p>What we're all about</p>
    </div>
  </Page>
);
