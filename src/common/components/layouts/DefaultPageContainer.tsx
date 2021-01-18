import { css } from '@emotion/react';
import React from 'react';
import { Container } from 'reactstrap';

type Props = {
  children: React.ReactNode;
}

/**
 * Handles the display of the Next.js Page component (as "children")
 *
 * @param props
 */
const DefaultPageContainer: React.FunctionComponent<Props> = (props): JSX.Element => {
  const {
    children,
  } = props;

  const containerCss = css`
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
  `;

  return (
    <Container
      className={'page-container'}
      css={containerCss}
    >
      {children}
    </Container>
  );

};

export default DefaultPageContainer;
