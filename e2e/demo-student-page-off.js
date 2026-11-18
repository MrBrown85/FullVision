/* Demo Mode now starts with the sample class's Student Page on (shared/data-demo.js, applyDemoStudentPage).
   These specs were written for a class that starts with it off, and turn on what they need themselves.
   Marking the sample class as already set up, once Demo Mode is on and before the app reads it, keeps
   it off for them. A spec that wants it on does not use this. */
export function demoStudentPageOff(page) {
  return page.addInitScript(() => {
    try {
      if (localStorage.getItem('gb-demo-mode') === '1' && localStorage.getItem('gb-demo-student-page') == null) {
        localStorage.setItem('gb-demo-student-page', 'on');
      }
    } catch (e) {
      /* storage blocked */
    }
  });
}
