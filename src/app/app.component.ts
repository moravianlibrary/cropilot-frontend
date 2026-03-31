import { Component, inject } from '@angular/core';
import { EnvironmentService } from './services/environment.service';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent {
  envService = inject(EnvironmentService);

  ngOnInit(): void {
    this.logDevInfo();
  }

  logDevInfo(): void {
    const devInfo = {
      useStaticRuntimeConfig: this.envService.get('useStaticRuntimeConfig'),
      devMode: this.envService.get('devMode'),
      environmentCode: this.envService.get('environmentCode'),
      environmentName: this.envService.get('environmentName'),

      serverBaseUrl: this.envService.get('serverBaseUrl'),
      authToken: this.envService.get('authToken'),

      gitCommitHash: this.envService.get('git_commit_hash'),
      gitTag: this.envService.get('git_tag'),
      buildDate: this.envService.get('build_date'),
    };
    console.log('Dev Info:', devInfo);
    if (devInfo.gitCommitHash) {
      console.log('https://github.com/trineracz/orezy-frontend/commit/' + devInfo.gitCommitHash);
    }
  }
}

