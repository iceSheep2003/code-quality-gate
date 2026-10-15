import { tool } from "../version.mjs";
export const hostWorkflow = `name: Code Quality Gate
on: [pull_request, workflow_dispatch]
permissions:
  contents: read
jobs:
  quality-gate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npm install --global --ignore-scripts code-quality-gate@${tool.version}
      - name: Prepare project toolchain
        run: |
          if [ -f .code-quality-gate/ci-setup.sh ]; then
            sh .code-quality-gate/ci-setup.sh
          fi
      - run: code-quality-gate gate
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: code-quality-gate-report
          path: .quality/code-quality-gate/
`;
