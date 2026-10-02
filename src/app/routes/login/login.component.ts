import { Component, inject } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { FormsModule } from '@angular/forms';
import { IconComponent } from "../../components/icon/icon.component";
import { TPipe } from '../../i18n/t.pipe';

@Component({
  selector: 'app-login',
  imports: [FormsModule, IconComponent, TPipe],
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss'
})
export class LoginComponent {
  auth = inject(AuthService);
}
