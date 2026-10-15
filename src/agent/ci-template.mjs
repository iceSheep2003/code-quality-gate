export const hostWorkflow = `name: VerityGate
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
      - run: npm install --global --ignore-scripts veritygate@0.4.0
      - name: Prepare project toolchain
        run: |
          if [ -f .veritygate/ci-setup.sh ]; then
            sh .veritygate/ci-setup.sh
          fi
      - run: veritygate gate
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: veritygate-report
          path: .quality/veritygate/
`;
